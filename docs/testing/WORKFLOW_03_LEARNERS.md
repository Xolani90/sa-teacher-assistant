# Workflow 3: Learners — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W3 – Learners |
| Git Branch | |
| Git Commit | |
| Dashboard Version | |
| API Commit (if different) | |
| Environment | ☐ Local Dev ☐ Staging ☐ Production |
| Executed By | |
| Date | |

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
| W3-01 | 3.1 | GET /api/learners for logged-in teacher | 200, `learners: [...]` scoped to teacher, alphabetical by canonicalName | status: ___ · count: ___ | ☐ |
| W3-02 | 3.2 | Confirm phoneHash/removedAt are absent from response | Not present in any learner object | present: Y/N | ☐ |
| W3-03 | 3.3 | Teacher with zero learners → GET /api/learners | 200, `learners: []`, not an error | status: ___ | ☐ |
| W3-04 | 3.4 | Click into a learner → GET /api/learners/:learnerId/detail | 200, full aggregated payload (profile, class name, assessment history, observation history, mastery, intervention plan present) | status: ___ | ☐ |
| W3-05 | 3.5 | Invalid learnerId (0, -1, "abc") → GET .../detail | 400, `learnerId must be a positive integer.` | status: ___ | ☐ |
| W3-06 | 3.6 | Nonexistent learnerId → GET .../detail | 404, `Learner not found.` | status: ___ | ☐ |
| W3-07 | 3.7 | GET /api/learners/:learnerId/intervention-plan for learner with evidence | 200, `{ learnerId, plans: [...] }` non-empty | status: ___ · plan count: ___ | ☐ |
| W3-08 | 3.8 | Same, for learner with zero evidence | 200, `{ learnerId, plans: [] }` — not an error | status: ___ | ☐ |
| W3-09 | 3.9 | Invalid learnerId → GET .../intervention-plan | 400 | status: ___ | ☐ |
| W3-10 | 3.10 | Nonexistent learnerId → GET .../intervention-plan | 404, `Learner not found.` | status: ___ | ☐ |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W3-S1 | S1 | Teacher A requests Teacher B's learnerId on .../detail | 404 identical to "not found" (not 403, no data leak) | status: ___ | ☐ |
| W3-S2 | S2 | Teacher A requests Teacher B's learnerId on .../intervention-plan | 404 identical to "not found" | status: ___ | ☐ |
| W3-S3 | S3 | Request /api/learners without Authorization header | 401 | status: ___ | ☐ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W3-11 | 3.11 | Browse Learners list → Learner Detail → Intervention Plan, full sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Clean: Y/N | ☐ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W3-T1 | T1 | Observe latency for learner detail (composed from multiple sources) | Reasonable latency, correct loading states | Optional |

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| | | | | | |

## Workflow Result
- Functional: ☐ Pass ☐ Fail
- Security: ☐ Pass ☐ Fail
- Console: ☐ Clean ☐ Issues found
- Critical findings: ___
- Major findings: ___
- Minor findings: ___
- Retests required: ___
- Execution time: ___ minutes
- Overall: ☐ PASS ☐ FAIL
- Reason (if FAIL): ___

## Carry Forward
WF4 (Assessments) prerequisites: ___ (or "None")

## Sign-off
- Workflow Executed By: __________
- Date: __________
- Git Commit / Branch: __________
- Environment: ☐ Local Dev ☐ Staging ☐ Production
