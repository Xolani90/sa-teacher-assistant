# ADR-008: Teacher Authentication

## 1. Status

**Accepted (design) — not yet implemented.** This revises the prior
"Proposed — scoping only" version of this document. That version
deliberately deferred every decision; this version makes them. No code
changes accompany this revision — `routes/api.js`'s `GET
/api/learners/:learnerId/intervention-plan` (ADR-007 PR10) continues to use
`requireAdminSecret` (`utils/adminAuth.js`) until an implementation PR
follows the design below.

**Depends on:** ADR-003 (learner identity), ADR-004 (class-aware identity),
ADR-007 (the service layer `/api` sits in front of).

---

## 2. Context

Every existing delivery surface establishes "who is asking" a different way,
and none of them generalize to an arbitrary HTTP client:

```
WhatsApp    → sender's phone number, verified by Meta → hashPhone() → teacher row
PDF         → unscoped per-file HMAC token (proves "you have this link", not "you are teacher X")
/api (PR10) → ADMIN_SECRET, a single shared secret ("you're an operator", not "you're teacher X")
```

There is currently no primitive anywhere in this codebase for an HTTP
client to assert a specific teacher identity, nor for the server to check
"does this teacher own this learner/class" outside of the phone-hash-scoped
queries `learnerRepository`/`interventionService` already perform
internally per-request using a `phoneHash` handed to them directly by
`workspaceFlow.js`.

A real teacher-facing dashboard, mobile app, or third-party integration
needs that primitive.

---

## 3. Problem Statement

`routes/api.js` and any future teacher-facing HTTP surface need a way to
answer, per request: *which teacher is this, and are they allowed to see
the learner/class/resource they're asking about?* — without requiring any
change to the domain services that already answer "what does this
teacher's data look like."

This is two separable problems, not one:

- **Authentication** — establishing that a request genuinely comes from
  teacher X.
- **Authorization** — confirming teacher X is allowed to see the specific
  learner/class/resource named in the request.

Conflating them (e.g. baking ownership checks into the auth middleware)
would recreate the exact problem ADR-001 already warned against for flow
boundaries, one layer up in the stack.

---

## 4. Decision

Implement teacher-facing authentication as JWT-based bearer tokens,
verified in a single piece of middleware that terminates authentication and
attaches a minimal identity to the request. Authorization remains where it
already lives: inside the domain/repository layer, exactly as it does
today for WhatsApp.

**Authentication resolves identity. Authorization validates ownership.**
These are different layers and must stay different layers:

```
JWT  →  teacher.id  →  SELECT phone_hash  →  req.teacher = { id, phoneHash }
```

Authentication's job ends the moment `req.teacher` is populated. Routes
then call services exactly as `workspaceFlow.js` does today:

```js
getLearnerInterventionPlan(req.teacher.phoneHash, learnerId)
```

The ownership check (does this `phoneHash` actually have a learner/class
with this id) stays inside the existing repository/service logic that
already scopes every query by `phoneHash`. The authentication layer never
needs to know what a learner, class, worksheet, or intervention plan is.

### 4.1 JWT subject: `teacher.id`, not `phone_hash`

The JWT's `sub` claim is `teachers.id` (the existing autoincrement PK),
not `phone_hash`.

`phone_hash` is an implementation detail — an HMAC of a normalized phone
number under `PII_SECRET`. It is used today as a de facto foreign key
across `learners`, `usage_events`, `subscriptions`, `saved_resources`, and
more, but that is an internal storage convention, not something that
should be embedded permanently into every issued token. If `PII_SECRET` is
ever rotated, or phone normalization logic changes, every outstanding
token minted with `phone_hash` as its subject would need silent
invalidation or become wrong. A surrogate primary key is immune to that
class of migration entirely.

Middleware resolves the surrogate key to the internal identity on every
request:

```
JWT.sub (teacher.id)
   ↓
SELECT phone_hash FROM teachers WHERE id = ?
   ↓
req.teacher = { id, phoneHash }
```

This one extra lookup is the entire cost of the isolation. Every existing
service keeps taking `phoneHash` exactly as it does today; nothing below
the middleware layer changes.

### 4.2 Operator authentication is not replaced

Teacher authentication does not replace `ADMIN_SECRET`. These are two
different trust domains protecting two different audiences:

| Domain | Routes | Mechanism |
|---|---|---|
| Operator | `/admin/stats`, `/admin/grant-pro` | `ADMIN_SECRET` (shared secret) |
| Teacher | `/api/*` (once migrated), future dashboard/mobile | JWT (per-teacher identity) |

`ADMIN_SECRET` remains the operator credential until a separate operator
identity system is ever introduced as its own ADR — that is out of scope
here. Collapsing the two into one mechanism would risk accidentally
broadening teacher-token privileges to operator-only endpoints, or
vice versa. They stay structurally separate.

### 4.3 Signed PDF downloads are out of scope

The existing `GET /pdf/:fileId?t=<token>` HMAC scheme is a signed
download URL, not an authentication mechanism — a common and legitimate
pattern even inside otherwise fully-authenticated systems. This ADR does
not change it. Existing HMAC download tokens remain unchanged. A future
ADR may add expiry, revocation, or a requirement that downloads be bound
to an authenticated teacher identity — that decision is deliberately
deferred to keep this ADR focused on the identity/authorization primitive.

### 4.4 Login/issuance mechanism is deliberately unspecified

This ADR establishes only that: **teacher authentication issues signed
access tokens representing a teacher identity.** It does not decide how a
teacher first obtains one — OTP, WhatsApp-delivered magic link, QR code,
or something else are all compatible implementation choices and can be
settled in a follow-up ADR or PR without revisiting anything decided here.

---

## 5. Architecture

```
HTTP request
      ↓
Rate limiting (existing pattern, adminLimiter-equivalent)
      ↓
Authentication middleware
  - verifies JWT signature + expiry
  - resolves teacher.id → phone_hash
  - sets req.teacher = { id, phoneHash }
      ↓
Route (routes/api.js, unchanged shape)
      ↓
Service (interventionService, learnerRepository, ...) — unchanged
  - ownership/authorization enforced here via existing phoneHash-scoped
    queries, same as WhatsApp today
```

This is a direct extension of the pattern ADR-007 PR10 already
established and documented in its own header comment: *"When [real auth]
lands, only the auth middleware at the mount point in server.js needs to
change — this handler and everything it calls stays the same."*
Discovery confirmed this holds in practice today; this ADR makes it a
binding invariant rather than an aspiration.

### 5.1 Non-negotiable invariant

No service may ever parse a JWT, inspect a request header, or otherwise
become aware that HTTP authentication exists. `interventionService.js`,
`learnerRepository.js`, `masteryService.js`, etc. take a `phoneHash`
argument today and must continue to take exactly that — nothing more —
regardless of what authentication mechanism sits in front of them
tomorrow.

---

## 6. Authentication Boundary

Authentication middleware is the only code permitted to:
- read the `Authorization` header
- verify a JWT signature
- resolve `teacher.id` to `phone_hash`

Everything downstream — routes and services — receives `req.teacher` as
plain data and is authentication-agnostic.

---

## 7. Identity Model

- **Subject of trust:** `teachers.id` (existing PK, already stable).
- **Internal resolution:** `phone_hash`, resolved once per request by
  middleware, never embedded in the token itself.
- **WhatsApp identity vs. dashboard identity:** both resolve to the same
  `teachers` row via the same `phone_hash`. This ADR does not introduce a
  second, independent identity concept — a teacher authenticated via a
  future dashboard is the same row as the teacher messaging via WhatsApp.
  (Whether a school-admin-only identity with no WhatsApp presence is ever
  needed is a real future question, but nothing here blocks adding it
  later as an additive schema change.)

---

## 8. Authorization Model

Authorization is **not** a property of the token. It is a property of
each query, exactly as it is today for WhatsApp:

```
getLearnerInterventionPlan(phoneHash, learnerId)
```

If `learnerId` doesn't belong to `phoneHash`, the existing repository
logic already returns nothing / not-found, the same way it would if a
WhatsApp teacher tried to reference a learner outside their own roster.
No new ownership-check layer is introduced — the existing phoneHash-scoped
query pattern *is* the authorization model, and JWT auth's only job is to
supply that `phoneHash` correctly and safely.

---

## 9. Operator Authentication

Unchanged. See §4.2. `ADMIN_SECRET` continues to gate `/admin/stats` and
`/admin/grant-pro` exactly as it does today. It is explicitly not this
ADR's concern to replace, and no work here should touch `utils/adminAuth.js`.

---

## 10. Migration Plan

```
Today:
  /api  →  ADMIN_SECRET  →  routes/api.js  →  InterventionService

After implementation:
  /api  →  JWT auth middleware  →  req.teacher  →  routes/api.js  →  InterventionService
                                                      (unchanged)         (unchanged)
```

Concretely:
1. Add JWT verification middleware (new file, e.g. `utils/teacherAuth.js`,
   mirroring `utils/adminAuth.js`'s structure and `yocoWebhookVerifier.js`'s
   style — timing-safe comparisons, explicit rejection reasons).
2. Add `teacher.id` → `phone_hash` resolution inside that middleware.
3. Swap `requireAdminSecret` for the new middleware at the `/api` mount
   point in `server.js` only.
4. `routes/api.js` gains a second query-shape check: pass
   `req.teacher.phoneHash` into `getLearnerInterventionPlan` /
   `getLearnerById` wherever `learnerId` is looked up, so a token for
   teacher A can never retrieve teacher B's learner.
5. No changes to `services/`, `flows/`, `core/`, or any test file that
   exercises those layers directly.
6. `/admin/*` and `/pdf/*` are untouched.

---

## 11. Alternatives Considered

- **Session-based auth (server-side session store).** Rejected: no
  session infrastructure exists anywhere in this codebase today, and
  Render's ephemeral filesystem (already a documented constraint — see
  `DB_PATH` warnings) makes an in-process session store fragile without
  adding an external store (Redis, etc.) purely for this. JWT avoids
  introducing a new stateful dependency.
- **`phone_hash` as JWT subject.** Rejected — see §4.1. Couples every
  issued token to a specific hashing implementation detail that may need
  to change independently of authentication.
- **Collapse operator and teacher auth into one mechanism.** Rejected —
  see §4.2. Different trust domains; collapsing them risks privilege
  leakage in either direction.
- **Decide the login/issuance mechanism now.** Rejected for this pass —
  see §4.4. Not required to unblock the architecture; better decided when
  a specific client (dashboard, mobile) makes the tradeoffs concrete.
- **Fold PDF download auth into this ADR.** Rejected — see §4.3. Different
  problem (possession-token vs. persistent identity); scoping it in here
  would blur an otherwise focused decision.

---

## 12. Consequences

- `/api` remains internal/admin-only in practice until the migration in
  §10 is actually implemented — this ADR is the design, not the PR.
- Once implemented, no service-layer code changes are required to support
  teacher-facing HTTP access; the entire cost is new middleware plus one
  additional `phoneHash` argument threaded through routes that don't
  already take it directly from WhatsApp.
- `ADMIN_SECRET` and JWT auth coexist permanently as separate mechanisms
  for separate audiences — this is a deliberate, stated architecture
  choice, not a temporary state.
- Signed PDF URLs remain a separate, unresolved concern — tracked, not
  solved, by this ADR.
- A latent, out-of-scope risk flagged for future awareness: because
  `phone_hash` is used as a de facto foreign key across many tables today,
  any future rotation of `PII_SECRET` is already a nontrivial migration
  independent of this ADR. Choosing `teacher.id` as the JWT subject
  insulates *tokens* from that risk, but does not solve it at the
  database layer.

---

## 13. Open Questions

Discovery and this decision resolved most of what the prior scoping
version left open. What remains is implementation-level, not
architectural:

1. **Issuance mechanism** (OTP / magic link / QR / other) — deliberately
   deferred per §4.4; needs a decision before a real login flow ships,
   but does not block building the verification middleware itself.
2. **Token lifetime and refresh strategy** — standard JWT expiry/refresh
   tradeoffs; not architecturally significant enough to block this ADR.
3. **Client parity** — whether a future mobile app shares the exact same
   token mechanism as the web dashboard, or gets longer-lived device
   tokens. Can be answered when a mobile client is actually being built.
