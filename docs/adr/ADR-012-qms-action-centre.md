# ADR-012: QMS Action Centre

## 1. Status

**Accepted (design) — not yet implemented.** No code changes accompany
this document. The implementation PR follows the plan in §10.

**Depends on:** ADR-010 (QMS/TSE relationship), ADR-011 (QMS domain
model), ADR-008 (teacher authentication — the dashboard this feature
extends).

---

## 2. Context

The QMS Readiness dashboard page (`dashboard/src/pages/QMS.jsx`) currently
renders `GET /api/tse/status` and `GET /api/reflections` verbatim: a
strength banner, five evidence-category counts, and a reflections list.
It answers *"what evidence exists?"* but not *"what should I do about
it?"* — a teacher looking at `Curriculum Coverage: 0` has no path from
that number to an action.

The dashboard already has several fully-built destination pages
(`Classes`, `ClassDetail`, `AssessmentDetail`) and several capabilities
that exist only via WhatsApp (lesson plan generation, worksheet
generation, starting an observation). There is currently no primitive
anywhere in the dashboard for surfacing "here's what to do next, and
here's how" in a way that's honest about which of those two categories a
given action falls into.

---

## 3. Problem Statement

The QMS page needs to go from a passive status report to an actionable
one, without:

- introducing routes for destinations that don't functionally exist yet
  (a `/qms/observation` page would just be a worse `Classes` page or a
  dead end, since observation capture is WhatsApp-only today)
- conflating "recommend an action" with "perform the action" — the QMS
  page should orchestrate, not own, workflows
- requiring backend changes to ship a first, useful version

---

## 4. Decision

The QMS Readiness page remains a **single orchestration page**, not a
collection of sub-pages. Each of the five evidence categories expands
inline (click to toggle) to reveal:

- current status (derived from the existing `counts` /
  `missingCategories` data QMS already receives)
- 2–3 recommended actions (static, rule-based text)
- contextual CTAs

**The page does not own workflows. It orchestrates existing workflows.**
Every CTA either navigates to a real destination, tells the teacher the
real WhatsApp command, or is honestly disabled. The QMS page never
pretends a capability exists that doesn't.

### 4.1 CTA policy

This is the load-bearing decision in this ADR. Every CTA button falls
into exactly one of three types:

| Type | Behaviour |
|---|---|
| Dashboard route exists | Navigate directly (`<Link>`/`navigate()`) |
| Existing WhatsApp capability, no dashboard route | Show the command/instruction text — never a dead link |
| Capability not yet implemented anywhere | Disabled button, labelled "Coming soon" |

Worked mapping for the five categories at time of writing:

- **Assessment** — `View Assessments` → `/assessments`; `Open Class` →
  `/classes` (both existing routes; Type 1).
- **Learner Support** — `Open Class` → `/classes`; `Review Learners` →
  `/classes/:id` (Type 1).
- **Observation** — no dashboard route exists. CTA renders as
  instruction text: *Message your assistant: "start observation"*
  (Type 2). No route is invented to paper over this gap.
- **Curriculum** — same pattern: *Message your assistant: "lesson plan"*
  / *"worksheet"* (Type 2).
- **Resources** — *Message your assistant: "my resources"* (Type 2).

This mapping is expected to shift over time as more dashboard routes are
built (e.g. if an Observation capture page ships later, its category
moves from Type 2 to Type 1) — the ADR fixes the *policy*, not the
mapping, since the mapping is data that will go stale.

### 4.2 Recommendation engine: Phase 1 is rule-based, frontend-only

Recommendations are derived entirely in the frontend from data the
backend already returns (`counts[category]` and `missingCategories`).
No new backend endpoint, service, or schema change is introduced.

```
count == 0  → onboarding-flavoured recommendations
              (e.g. "Complete a classroom observation")
count > 0   → maintenance-flavoured recommendations
              (e.g. "Review high-priority learners")
```

No AI, no scoring, no weighting, no persistence of recommendation state.
This keeps the PR a pure presentation change. A later ADR/PR may
introduce a `qmsRecommendationService` that computes richer,
data-driven recommendations server-side (e.g. actually querying which
learners are below a threshold); when that happens, the frontend
component contract is designed not to need to change — see §4.3.

### 4.3 Component structure

Splitting the page keeps the expand/collapse and CTA-rendering logic
reusable rather than folded into one large file:

```
QMS.jsx
  ├── QMSSummaryBanner      (existing strength banner, unchanged)
  ├── QMSCategoryCard       (owns: expand/collapse state, status badge,
  │                          evidence count, delegates action rendering)
  ├── QMSCategoryActions    (renders recommendation text + CTA per
  │                          the Type 1/2/3 policy in §4.1)
  └── ReflectionPanel       (existing reflections list, unchanged)
```

`QMSCategoryCard` takes `category`, `count`, `isMissing`, and a static
`recommendations` config (see §4.2) as props — it does not know *why* a
recommendation was chosen, only how to render one. This is the seam a
future `qmsRecommendationService` would plug into without changing
`QMSCategoryCard` itself, mirroring the "services return contracts,
components render them verbatim" convention already used for
`AssessmentDetail.jsx` / `ClassDetail.jsx`.

---

## 5. Architecture

```
GET /api/tse/status        (existing, unchanged)
GET /api/reflections       (existing, unchanged)
        ↓
QMS.jsx (orchestrator — unchanged data-fetching)
        ↓
QMSCategoryCard × 5  (new — presentation only)
        ↓
QMSCategoryActions  (new — CTA policy in §4.1, static rules in §4.2)
        ↓
   navigate()  →  existing routes (/classes, /assessments, ...)
   OR
   instruction text  →  WhatsApp command (no navigation)
   OR
   disabled "Coming soon" button
```

No new backend routes, services, or migrations. No new frontend routes.

---

## 6. PR Scope

- ✅ Expandable cards (`QMSCategoryCard`)
- ✅ Static recommendation rules (§4.2)
- ✅ CTA buttons following the Type 1/2/3 policy (§4.1)
- ✅ Reusable category card component
- ❌ No backend changes
- ❌ No new routes
- ❌ No new services
- Existing APIs only (`/api/tse/status`, `/api/reflections`)

---

## 7. Alternatives Considered

- **Separate routes per category (`/qms/observation`, etc.).** Rejected
  for this phase. Would require inventing destination pages for
  categories that have no dashboard-side capability yet (Observation,
  Curriculum, Resources), duplicating navigation chrome and empty-state
  logic five times over for what is still fundamentally one page's
  worth of content. Revisit once individual categories have enough
  real, distinct functionality to justify their own route — at that
  point they become genuine drill-downs rather than placeholder shells.
- **Backend-computed recommendations from the start.** Rejected for
  Phase 1 — see §4.2. Would require a new service and turn a pure
  frontend PR into a backend + frontend PR for marginal benefit at this
  stage; the rule-based version is good enough to ship and validate the
  UI pattern first.
- **Silently disabling all CTAs for WhatsApp-only capabilities.**
  Rejected. Showing the actual command (Type 2) is more useful than a
  disabled button and costs nothing extra to implement — "Coming soon"
  (Type 3) is reserved for capabilities that don't exist anywhere yet,
  not ones that exist on a different surface.

---

## 8. Consequences

- The QMS page becomes the dashboard's daily-use "what should I work on"
  entry point rather than a status report, without expanding the
  system's architectural surface area.
- Every CTA on the page is honest: it either works today (Type 1), tells
  the teacher exactly how to do it today via WhatsApp (Type 2), or
  admits it doesn't exist yet (Type 3). No dead links.
- The CTA mapping (§4.1) will require small updates as new dashboard
  routes ship and categories migrate from Type 2 to Type 1 — this is
  expected maintenance, not a design flaw.
- `QMSCategoryCard` / `QMSCategoryActions` become the first reusable
  "action card" components in the dashboard; a future ADR may formalize
  them for reuse elsewhere (e.g. a Home/Overview page) if that need
  arises.

---

## 9. Open Questions

1. **Learner Support "Review high-priority learners".** A genuinely
   useful version of this recommendation requires knowing *which*
   learners are high-priority — data the current `/api/tse/status`
   payload doesn't carry. Phase 1 ships this as a generic recommendation
   pointing at `/classes`; a real implementation is deferred to whatever
   PR introduces `qmsRecommendationService` (§4.2).
2. **Does "Coming soon" ever apply today?** At time of writing, every
   category maps to either Type 1 or Type 2 — no category currently
   needs a Type 3 button. The policy is defined for completeness and
   future-proofing rather than an immediate need.
