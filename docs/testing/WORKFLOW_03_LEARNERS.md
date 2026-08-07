# Workflow 3: Learners — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W3 – Learners |
| Git Branch | main |
| Git Commit | be6bfe91a526ec8a5828f0f1bb55f359f9836226 |
| Dashboard Version | |
| API Commit (if different) | |
| Environment | ☑ Local Dev |
| Executed By | Moleboheng |
| Date | 2026-08-07 |

## Implementation Coverage
- `GET /api/learners` — list via `learnerRepository.getTeacherLearners`, scoped to `req.teacher.phoneHash`, alphabetical by canonicalName, phoneHash/removedAt excluded from response.
- `GET /api/learners/:learnerId/detail` — aggregated Learner Detail (profile, class name, assessment history, observation history, mastery, intervention plan) via `learnerDetailService.getLearnerDetail`.
- `GET /api/learners/:learnerId/intervention-plan` — `interventionService.getLearnerInterventionPlan`, returns `{ learnerId, plans: [] }` (empty array, not an error, when no evidence exists yet — deliberate divergence from the PDF generator's behavior, which errors on zero plans).

## Preconditions
- Logged-in teacher session (Workflow 1 passed).
- Test teacher has ≥1 learner with assessment + observation history (for
  detail/intervention-plan non-empty paths).
- Test teacher has ≥1 learner with zero evidence (to confirm `plans: []`
  and empty-state detail sections don't error).
- A second teacher's learnerId is known, to test ownership scoping.

## Environment Notes
- `intervention-plan` returning `200 { plans: [] }` for a learner with no
  evidence is correct behavior, not a bug — don't log it as a finding.
- Compare this to the WhatsApp PDF path (`generateLearnerInterventionPdf`),
  which errors on zero plans; the dashboard intentionally diverges so it
  can render "no data yet" vs. "learner not found" from response shape.

## Stop Conditions
**Critical:**
- Any of the three endpoints returns another teacher's learner data for
  an ID it does not own (must be 404, not 403 — ADR-008 §8)
- Server 500 on any endpoint for a valid, owned learnerId
- Uncaught console exception while browsing Learners list → Learner
  Detail → Intervention Plan

**Non-blocking:** cosmetic UI, spinner/timing, copy, minor layout.

## Functional Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W3-01 | 3.1 | GET /api/learners for logged-in teacher | 200, `learners: [...]` scoped to teacher, alphabetical by canonicalName | status: 200 · count: 10, alphabetical by canonicalName confirmed | ☑ |
| W3-02 | 3.2 | Confirm phoneHash/removedAt are absent from response | Not present in any learner object | present: N — confirmed absent in raw JSON, and unable to leak by construction (excluded at SQL projection level, not just object mapping) | ☑ |
| W3-03 | 3.3 | Teacher with zero learners → GET /api/learners | 200, `learners: []`, not an error | NOT LIVE-TESTED — no zero-learner teacher account available this session. Code-reviewed only: handler uses `learners || []` fallback, identical pattern to W2-03's classes handler. Low risk, not blocking. | ☐ |
| W3-04 | 3.4 | Click into a learner → GET /api/learners/:learnerId/detail | 200, full aggregated payload (profile, class name, assessment history, observation history, mastery, intervention plan present) | status: 200 — Aisha Petersen (id 6): overall average 30%, pass rate 0%, trend "Needs attention", assessment history (2 entries), CAPS coverage empty-state (expected, Grade 6 gap), intervention priorities populated | ☑ |
| W3-05 | 3.5 | Invalid learnerId (0, -1, "abc") → GET .../detail | 400, `learnerId must be a positive integer.` | status: 400, `{"error":"learnerId must be a positive integer."}` | ☑ |
| W3-06 | 3.6 | Nonexistent learnerId → GET .../detail | 404, `Learner not found.` | status: 404, `{"error":"Learner not found."}` | ☑ |
| W3-07 | 3.7 | GET /api/learners/:learnerId/intervention-plan for learner with evidence | 200, `{ learnerId, plans: [...] }` non-empty | status: 200 · plan count: 1 (Aisha Petersen, Mathematics, High priority) | ☑ |
| W3-08 | 3.8 | Same, for learner with zero evidence | 200, `{ learnerId, plans: [] }` — not an error | status: 200, `{"learnerId":11,"plans":[]}` — confirmed via freshly-seeded zero-evidence learner (Teacher B Test Learner); full detail payload also confirmed correct empty-state shape (`overallAverage: null`, `assessmentHistory: []`, `trend: "insufficient-data"`) | ☑ |
| W3-09 | 3.9 | Invalid learnerId → GET .../intervention-plan | 400 | status: 400, `{"error":"learnerId must be a positive integer."}` | ☑ |
| W3-10 | 3.10 | Nonexistent learnerId → GET .../intervention-plan | 404, `Learner not found.` | status: 404, `{"error":"Learner not found."}` | ☑ |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W3-S1 | S1 | Teacher A requests Teacher B's learnerId on .../detail | 404 identical to "not found" (not 403, no data leak) | status: 404, `{"error":"Learner not found."}` | ☑ |
| W3-S2 | S2 | Teacher A requests Teacher B's learnerId on .../intervention-plan | 404 identical to "not found" | status: 404, `{"error":"Learner not found."}` | ☑ |
| W3-S3 | S3 | Request /api/learners without Authorization header | 401 | status: 401, `{"error":"Unauthorized"}` | ☑ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W3-11 | 3.11 | Browse Learners list → Learner Detail → Intervention Plan, full sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Clean: Y — no uncaught exceptions after full console inspection (verified past initial filter/hidden-message confusion). 2 React Router future-flag warnings (carried from W1/W2, non-blocking) + 1 new Chrome accessibility issue (form field missing id/name attribute) | ☑ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W3-T1 | T1 | Observe latency for learner detail (composed from multiple sources) | Reasonable latency, correct loading states | Optional |

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| W3-F1 | Minor | 3.11 | Chrome accessibility issue: a form field element (likely Learner Detail's roster search input) is missing an `id`/`name` attribute | DevTools Issues tab | Deferred — non-blocking, cosmetic/accessibility hygiene, not a stop condition |
| W3-F2 | Minor | 3.1 | Inconsistent timestamp formats across learner rows: `classId 2` learners use ISO 8601 (`2026-07-30T09:53:58.671Z`), `classId 4` learners use SQLite datetime (`2026-07-31 11:43:44`) | Raw `/api/learners` JSON | Deferred — likely an artifact of different seeding paths, not a live defect; worth normalizing if any code later sorts/parses these as dates |
| W3-F3 | Minor | 3.11 | React Router v7 future-flag deprecation warnings (carried forward from W1/W2) | Console | Deferred — library-level, addressed at next React Router major upgrade |

## Workflow Result
- Functional: ☑ Pass (W3-03 not live-tested — see Retests required)
- Security: ☑ Pass
- Console: ☑ Clean
- Critical findings: 0
- Major findings: 0
- Minor findings: 3
- Retests required: W3-03 (zero-learner teacher, not live-tested — low risk, not blocking; recommend running before final RC-1 tag if time permits)
- Execution time: ___ minutes (fill in your actual time)
- Overall: ☑ PASS
- Reason (if FAIL): N/A

## Carry Forward
WF4 (Assessments) prerequisites: None

## Sign-off
- Workflow Executed By: Moleboheng
- Date: 2026-08-07
- Git Commit / Branch: be6bfe91a526ec8a5828f0f1bb55f359f9836226 / main
- Environment: ☑ Local Dev
