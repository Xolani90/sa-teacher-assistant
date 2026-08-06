# Workflow 7: Observations — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W7 – Observations |
| Git Branch | |
| Git Commit | |
| Dashboard Version | |
| API Commit (if different) | |
| Environment | ☐ Local Dev ☐ Staging ☐ Production |
| Executed By | |
| Date | |

## Implementation Coverage
- `GET /api/observations` — `observationRepository.getObservationHistory(phoneHash, filters)`, a direct repository-level read (no service layer) supporting `?grade=&subject=&learnerName=&includeSuperseded=&limit=`, scoped to the teacher.
- `GET /api/observations/:assessmentId` — aggregated Observation Detail via `observationDetailService.getObservationDetail`, which composes `getObservationAssessment()` with its correction-lineage neighbors.

## Preconditions
- Logged-in teacher session (Workflow 1 passed).
- Test teacher has ≥1 observation session with at least one correction
  in its lineage (to verify correction-lineage neighbors render, not
  just the latest record).
- Test teacher has ≥1 superseded observation (to test
  `includeSuperseded` filtering).
- A second teacher's observation `assessmentId` is known, to test
  ownership scoping.

## Environment Notes
- `/observations/:assessmentId` takes an **assessmentId**, not an
  "observationId" — same identifier space as the Assessments workflow's
  `assessmentId`. Don't confuse this with a class/learner id when
  constructing test requests.
- `includeSuperseded` defaults to excluding superseded records
  (`req.query.includeSuperseded === 'true'` — any other value, including
  omission, is falsy).

## Stop Conditions
**Critical:**
- `/observations` or `/observations/:assessmentId` returns another
  teacher's observation data for a request it does not own (must be
  404, not 403 — ADR-008 §8)
- Correction lineage exposes another teacher's corrected/superseded
  record
- Server 500 on either endpoint for a valid, owned request
- Uncaught console exception while browsing Observations list →
  Observation Detail

**Non-blocking:** cosmetic UI, spinner/timing, copy, minor layout.

## Functional Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W7-01 | 7.1 | GET /api/observations for logged-in teacher, no filters | 200, `observations: [...]` scoped to teacher | status: ___ · count: ___ | ☐ |
| W7-02 | 7.2 | Teacher with zero observations → GET /api/observations | 200, `observations: []`, not an error | status: ___ | ☐ |
| W7-03 | 7.3 | GET /api/observations?grade=<n> | 200, results filtered by grade | status: ___ | ☐ |
| W7-04 | 7.4 | GET /api/observations?subject=<subject> | 200, results filtered by subject | status: ___ | ☐ |
| W7-05 | 7.5 | GET /api/observations?learnerName=<name> | 200, results filtered by learner name | status: ___ | ☐ |
| W7-06 | 7.6 | GET /api/observations?includeSuperseded=true | 200, includes superseded records | status: ___ · superseded present: Y/N | ☐ |
| W7-07 | 7.7 | GET /api/observations (default, no includeSuperseded) | Superseded records excluded | Excluded: Y/N | ☐ |
| W7-08 | 7.8 | GET /api/observations?limit=<n> | 200, result count ≤ n | status: ___ · count: ___ | ☐ |
| W7-09 | 7.9 | Click into a session → GET /api/observations/:assessmentId | 200, full aggregated Observation Detail with correction lineage | status: ___ | ☐ |
| W7-10 | 7.10 | Invalid assessmentId (0, -1, "abc") → GET .../: assessmentId | 400, `assessmentId must be a positive integer.` | status: ___ | ☐ |
| W7-11 | 7.11 | Nonexistent assessmentId → GET .../:assessmentId | 404, `Observation session not found.` | status: ___ | ☐ |
| W7-12 | 7.12 | For a session with a correction history, confirm all correction-lineage neighbors appear | Full lineage present, not just latest record | Observed: ___ | ☐ |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W7-S1 | S1 | Teacher A requests Teacher B's assessmentId on /observations/:assessmentId | 404 identical to "not found" (not 403, no data leak) | status: ___ | ☐ |
| W7-S2 | S2 | Request /api/observations without Authorization header | 401 | status: ___ | ☐ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W7-13 | 7.13 | Browse Observations list (with filters) → Observation Detail, full sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Clean: Y/N | ☐ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W7-T1 | T1 | Observe latency for observations list with multiple filters applied | Reasonable latency, correct loading states | Optional |

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
This is the last workflow in RC-1's sequence. RC-1 is release-ready only
once all seven workflows are individually signed off as PASS against
the same git commit (see `docs/testing/README.md`).

## Sign-off
- Workflow Executed By: __________
- Date: __________
- Git Commit / Branch: __________
- Environment: ☐ Local Dev ☐ Staging ☐ Production
