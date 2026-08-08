# Workflow 7: Observations — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W7 – Observations |
| Git Branch | main |
| Git Commit | 976164b7562d3acc8016da6e99780b03b3662b29 |
| Dashboard Version | (local dev) |
| API Commit (if different) | |
| Environment | ☑ Local Dev ☐ Staging ☐ Production |
| Executed By | Xolani Tshabalala (+ Claude, evidence assembly) |
| Date | 2026-08-08 |

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
Evidence types cited below: **Automated** (existing mocked-handler unit
tests, `tests/api-observations.test.js`), **Real HTTP/DB** (real Express
app + real `requireTeacherAuth` middleware + real in-memory DB built from
the actual migration chain + real HTTP requests, `tests/w7-observations-
list-integration.test.js` and `tests/w7-observation-detail-integration.
test.js`), and **Browser** (live dashboard session, DevTools Network +
Console). A PASS backed only by Automated evidence is noted as such,
since mocked-handler tests prove the handler was called correctly but
not that the real auth boundary + DB + service composition works.

| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W7-01 | 7.1 | GET /api/observations for logged-in teacher, no filters | 200, `observations: [...]` scoped to teacher | Real HTTP/DB: 200; mixed-fixture teacher (10 seeded assessments) returned exactly 9 non-superseded rows, all correctly scoped, none leaked to/from a second identity | ☒ |
| W7-02 | 7.2 | Teacher with zero observations → GET /api/observations | 200, `observations: []`, not an error | Real HTTP/DB: 200, `observations: []` | ☒ |
| W7-03 | 7.3 | GET /api/observations?grade=<n> | 200, results filtered by grade | Real HTTP/DB: `grade=4` → 3/3 correct, from a fixture mixing grade 4 (3) and grade 6 (7). Browser: confirmed query-string wiring and refetch on filter change; live fixture data was uniformly Grade 6, so the browser pass verifies UI wiring only, not exclusion — exclusion is proven by the Real HTTP/DB fixture above | ☒ |
| W7-04 | 7.4 | GET /api/observations?subject=<subject> | 200, results filtered by subject | Real HTTP/DB: `subject=Home Language` → 3/3 correct, from a fixture mixing Mathematics (7) and Home Language (3). Browser: confirmed query-string wiring and refetch only — same caveat as W7-03, live fixture data was uniformly Mathematics | ☒ |
| W7-05 | 7.5 | GET /api/observations?learnerName=<name> | 200, results filtered by learner name | Real HTTP/DB: 1/1 correct result | ☒ |
| W7-06 | 7.6 | GET /api/observations?includeSuperseded=true | 200, includes superseded records | Real HTTP/DB: superseded original + its correction both present (10/10). Browser: confirmed live with seeded correction pair (assessmentId 3/4) — default list excluded id 3; `includeSuperseded=true` behavior corroborated by the Real HTTP/DB fixture | ☒ superseded present: Y |
| W7-07 | 7.7 | GET /api/observations (default, no includeSuperseded) | Superseded records excluded | Real HTTP/DB and Browser both confirm: superseded original absent from default list, its correction present | ☒ Excluded: Y |
| W7-08 | 7.8 | GET /api/observations?limit=<n> | 200, result count ≤ n | Real HTTP/DB: `limit=3` → exactly 3 results. **Informational observation, not a criterion failure:** `limit=0` is falsy in JavaScript, so the handler's `if (filters.limit)` check skips the `LIMIT` clause entirely and returns the full result set rather than zero rows. This checklist does not specify required behavior for `limit=0`, so it is not scored as a finding — recorded here for audit completeness only. | ☒ status: 200 · count: 3 |
| W7-09 | 7.9 | Click into a session → GET /api/observations/:assessmentId | 200, full aggregated Observation Detail with correction lineage | Real HTTP/DB: 200, `session.id` and `records` verified against seeded data. Browser: navigated to a real session (id 4), response body and rendered UI matched (name, grade, subject, records, "✓ Current Version") | ☒ |
| W7-10 | 7.10 | Invalid assessmentId (0, -1, "abc") → GET .../: assessmentId | 400, `assessmentId must be a positive integer.` | Real HTTP/DB: all three inputs return 400 with the exact expected message | ☒ |
| W7-11 | 7.11 | Nonexistent assessmentId → GET .../:assessmentId | 404, `Observation session not found.` | Real HTTP/DB: 404, exact expected message | ☒ |
| W7-12 | 7.12 | For a session with a correction history, confirm all correction-lineage neighbors appear | Full lineage present, not just latest record | Real HTTP/DB (backend): correction → `correctsAssessmentId` points at original, `isCurrent: true`; original → `supersededByAssessmentId` points at correction, `isCurrent: false`. **Browser (both directions independently exercised):** original shows "Superseded by correction" linking to the correction; correction shows "Corrects observation from…" linking to the original; clicking each link fired a fresh `GET /api/observations/:id` network request (not a client-side data swap) and rendered content changed to the correct record each time | ☒ Observed: full bidirectional lineage confirmed, backend + browser |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W7-S1 | S1 | Teacher A requests Teacher B's assessmentId on /observations/:assessmentId | 404 identical to "not found" (not 403, no data leak) | Real HTTP/DB: executed with two real teacher identities and real JWTs. Cross-teacher request → 404, response body byte-identical to the genuine-nonexistent-id 404 (confirms no existence oracle). Control case: Teacher B reading their own record with their own token → 200 | ☒ status: 404 (matches nonexistent-id 404 exactly) |
| W7-S2 | S2 | Request /api/observations without Authorization header | 401 | Real HTTP/DB: both `/observations` and `/observations/:id` return 401 with no auth header | ☒ status: 401 |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W7-13 | 7.13 | Browse Observations list (with filters) → Observation Detail, full sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Browser: full sequence executed with DevTools open (list → detail → lineage jump, both directions → back → grade/subject filters). Baseline noise present throughout but unchanged in count across every navigation (React DevTools install tip, 2 React Router v6 future-flag deprecation warnings, `favicon.ico` 404) — none application-related. Zero new red console entries introduced by any step. | ☒ Clean: Y |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W7-T1 | T1 | Observe latency for observations list with multiple filters applied | Reasonable latency, correct loading states | Optional |

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| | | | | | |

*Zero findings.* Every acceptance criterion in this workflow passed
under real execution (Real HTTP/DB and/or Browser, as applicable) rather
than code inspection or mocked-handler tests alone. The `limit=0`
behavior noted under W7-08 is recorded as an informational/edge-case
observation, not a finding — the checklist does not specify required
behavior for that input, so there is no criterion for it to violate.

## Workflow Result
- Functional: ☒ Pass ☐ Fail
- Security: ☒ Pass ☐ Fail
- Console: ☒ Clean ☐ Issues found
- Critical findings: 0
- Major findings: 0
- Minor findings: 0
- Retests required: 0
- Execution time: ___ minutes
- Overall: ☒ PASS ☐ FAIL
- Reason (if FAIL): n/a

## Carry Forward
This is the last workflow in RC-1's sequence. W7 has passed all required
functional, security, and console checks. RC-1's overall Release
Recommendation is not updated by this document — W4-F1 remains OPEN
(Major) in `RC1_SIGNOFF.md`, and per that document's governance rule,
RC-1 cannot move to Approved while any Major finding is open.

## Sign-off
- Workflow Executed By: Xolani Tshabalala (+ Claude, evidence assembly)
- Date: 2026-08-08
- Git Commit / Branch: main @ 976164b7562d3acc8016da6e99780b03b3662b29
- Environment: ☑ Local Dev ☐ Staging ☐ Production
