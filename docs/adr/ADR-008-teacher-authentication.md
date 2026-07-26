# ADR-008: Teacher Authentication (Scoping)

## 1. Status

**Proposed — scoping only.** This document exists to record decisions and
open questions ahead of any teacher-facing HTTP authentication work. It
deliberately contains no implementation: no chosen auth technology, no
schema, no middleware code. `routes/api.js`'s `GET
/api/learners/:learnerId/intervention-plan` (ADR-007 PR10) continues to use
`requireAdminSecret` (`utils/adminAuth.js`) as an internal-only placeholder
until a future PR implements whatever this ADR settles on.

**Depends on:** ADR-003 (learner identity), ADR-004 (class-aware identity),
ADR-007 (the service layer `/api` sits in front of).

---

## 2. Context

Every existing delivery surface establishes "who is asking" a different way,
and none of them generalize to an arbitrary HTTP client:

```
WhatsApp   → sender's phone number, verified by Meta → hashPhone() → teacher row
PDF        → unscoped per-file HMAC token (proves "you have this link", not "you are teacher X")
/api (PR10) → ADMIN_SECRET, a single shared secret ("you're an admin", not "you're teacher X")
```

There is currently no primitive anywhere in this codebase for an HTTP client
to assert a specific teacher identity, nor for the server to check "does
this teacher own this learner/class" outside of the phone-hash-scoped
queries `learnerRepository`/`learnerIdentityService` already do internally
per-request.

A real teacher-facing dashboard, mobile app, or third-party integration
needs that primitive. Building it hastily inside a single API PR would
conflate authentication (a cross-cutting, security-sensitive concern) with
whatever feature PR happens to need it first — the same mistake ADR-001
already warned against for flow boundaries, applied one layer up.

---

## 3. Decision

Defer implementation. Use this ADR to collect the questions that need
answers before implementation starts, so that when a dashboard or similar
consumer becomes a real near-term priority, the design conversation doesn't
start from zero and doesn't get rushed under feature pressure.

`ADMIN_SECRET` remains the gate on `/api` until a follow-up ADR (or a
revision of this one, once "Proposed — scoping only" is no longer
accurate) promotes it to "Accepted — implementing X."

### Out of scope for this document

- Login/registration UI of any kind
- Specific auth technology (JWT vs. opaque session tokens vs. OTP vs.
  WhatsApp-linked magic links — no default should be assumed by a reader of
  this ADR)
- Password reset / account recovery flows
- OAuth / third-party identity providers
- Database schema or migrations
- Middleware or route code
- A retirement timeline for `ADMIN_SECRET` on `/admin/*` — those routes are
  a separate, already-functioning internal-tooling surface and are not
  automatically in scope just because `/api` shares the same guard today

### Open questions (to be answered before implementation)

1. **Identity proof.** How does a teacher prove they are who they claim to
   be, given WhatsApp is the only channel that currently verifies anything
   about them? Does dashboard identity get bootstrapped *from* WhatsApp
   identity (e.g. a one-time code sent to the teacher's already-verified
   phone number), or is it independent (e.g. email/password), accepting
   that the two identities could then diverge?
2. **Token/session issuance and lifecycle.** Where are tokens minted, how
   long do they live, how are they refreshed, and how does a teacher log
   out (i.e. how is a token invalidated before its natural expiry)?
3. **Teacher → class → learner ownership.** The authorization check itself
   — "does the calling teacher own this specific learner" — needs a
   concrete rule, not just an authenticated identity. `learners.phone_hash`
   and `classes` already encode ownership internally; the open question is
   how a request-scoped identity gets checked against that without any API
   route reaching around `learnerRepository`/`interventionService` to do it
   ad hoc.
4. **Authorization scope per request.** Single-learner reads only, or does
   this need to eventually support class-level and multi-class (e.g. HOD)
   views? Answering this affects whether ownership checks are learner-level
   only or need a class/role dimension from the start.
5. **WhatsApp identity vs. dashboard identity.** Are these the same
   identity wearing two channels, or deliberately separate concepts (e.g. a
   school admin who manages the dashboard but never messages the bot)? This
   has schema implications (does `teachers` gain a login credential column,
   or does a new table sit beside it).
6. **Client parity.** Do web dashboard and any future mobile app share one
   auth mechanism, or does mobile get its own (e.g. long-lived device
   tokens vs. short-lived web sessions)?

### Sketch migration path (not a commitment to any specific technology)

```
Today:
  /api  →  ADMIN_SECRET  →  routes/api.js  →  InterventionService

Once the above questions are answered and implemented:
  /api  →  [chosen teacher-auth mechanism]  →  ownership check  →  routes/api.js  →  InterventionService
```

The important invariant, consistent with ADR-007's own layering rule:
whatever mechanism is chosen replaces only the authentication/authorization
middleware at the point `/api` is mounted in `server.js`. `routes/api.js`'s
handler and every service beneath it (`InterventionService`,
`MasteryService`, `ProgressService`, `CoverageService`,
`learnerTimelineService`, `learnerRepository`) should require zero changes —
they already take a `learnerId` as an argument and don't know or care how
the caller was authenticated.

---

## 4. Consequences

- `/api` stays internal/admin-only (per PR10's own documentation) until
  this ADR is revised from "Proposed — scoping only" to an accepted,
  implementable design.
- No teacher-facing dashboard, mobile client, or third-party integration
  should be built against `/api` while this ADR remains at scoping status —
  doing so would mean building a real product surface on top of a
  known-temporary, non-per-teacher auth gate.
- Feature work that doesn't require teacher-facing HTTP access (e.g. the
  class-level intervention rollup, which can be consumed the same way PR10
  was — admin/internal, or eventually WhatsApp-delivered like PR8) is not
  blocked by this ADR and can proceed independently.

## 5. Alternatives Considered

- **Implement a specific mechanism now (e.g. JWT + email/password), in the
  same PR that needed it.** Rejected for this pass: doing so inside a
  feature PR tends to under-specify the ownership-check question (§3.3)
  and the WhatsApp-identity-relationship question (§3.5), both of which
  have real schema consequences that are cheaper to get right once than to
  migrate later.
- **Do nothing / leave it entirely to whenever a dashboard PR needs it.**
  Rejected because it repeats the exact drift pattern already found and
  fixed in ADR-007's status header (a stale document misrepresenting the
  system's real state) — better to have an explicit, if intentionally
  unfinished, record of the open questions than no record at all.
