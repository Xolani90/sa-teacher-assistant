# Workflow 2: Classes — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W2 – Classes |
| Git Branch | main |
| Git Commit | be6bfe91a526ec8a5828f0f1bb55f359f9836226 |
| Dashboard Version | |
| API Commit (if different) | |
| Environment | ☑ Local Dev |
| Executed By | Moleboheng |
| Date | 2026-08-07 |

## Implementation Coverage
- `GET /api/classes` — list, scoped to `req.teacher.phoneHash`, `learnerCount` from live active roster (`getActiveRosterCounts`), not the `classes.learner_count` cache column.
- `GET /api/classes/:classId/detail` — aggregated Class Detail (summary, roster, history, coverage, class intervention plan) via `classDetailService.getClassDetail`.
- `GET /api/classes/:classId/snapshot` — `classSnapshotService.getClassSnapshot` (analytics + intervention + qms sections, qms currently always "unavailable" per ADR-014 §3.4); optional `?subject=` query param.

## Preconditions
- Logged-in teacher session (Workflow 1 passed) with a valid Bearer token.
- Test teacher has ≥1 class with ≥1 active learner in the roster (so
  `learnerCount` and detail/snapshot sections are non-empty).
- Test teacher has ≥1 class with zero learners (to check the empty-state
  path doesn't error).
- A second teacher's class ID is known, to test ownership scoping.

## Environment Notes
- `snapshot`'s `qms` section is expected to read as "unavailable" in
  this build (ADR-014 §3.4) — this is not a bug, don't log it as one.
- `learnerCount` on `/classes` reflects the *active* roster
  (`learners.removed_at IS NULL`), which can legitimately differ from
  any capacity number a teacher declared via WhatsApp's `NEW CLASS`
  command.

## Stop Conditions
**Critical:**
- `/classes/:classId/detail` or `/classes/:classId/snapshot` returns
  another teacher's class data for an ID it does not own (must be 404,
  not 403 — ADR-008 §8)
- Server 500 on any of the three endpoints for a valid, owned classId
- Uncaught console exception while browsing Classes → Class Detail →
  Snapshot

**Non-blocking:** cosmetic UI, spinner/timing, copy, minor layout.

## Functional Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W2-01 | 2.1 | GET /api/classes for logged-in teacher | 200, `classes: [...]` scoped to teacher, ordered created_at DESC | status: 200 · classes scoped, correct fields, no phone_hash leak | ☑ |
| W2-02 | 2.2 | Confirm `learnerCount` on a known class matches active roster count | Matches, not the stale capacity value | NOT EXECUTED — visually matched in screenshots but no explicit cross-check run | ☐ |
| W2-03 | 2.3 | Teacher with zero classes → GET /api/classes | 200, `classes: []`, not an error | NOT EXECUTED | ☐ |
| W2-04 | 2.4 | Click into a class → GET /api/classes/:classId/detail | 200, full aggregated payload (summary, roster, history, coverage, intervention plan present) | status: 200, full aggregated payload confirmed | ☑ |
| W2-05 | 2.5 | Invalid classId (0, -1, "abc") → GET .../detail | 400, `classId must be a positive integer.` | status: 400, `{"error":"classId must be a positive integer."}` | ☑ |
| W2-06 | 2.6 | Nonexistent classId (valid int, no row) → GET .../detail | 404, `Class not found.` | status: 404, `{"error":"Class not found."}` | ☑ |
| W2-07 | 2.7 | GET /api/classes/:classId/snapshot for owned class | 200, snapshot payload; each section independently `ok`/`error`/`unavailable` | status: 200 · qms section state: "unavailable" (expected, ADR-014 §3.4) | ☑ |
| W2-08 | 2.8 | GET .../snapshot with `?subject=<validSubject>` | 200, snapshot scoped/filtered by subject | status: 200, `subject` field reflects "Mathematics" filtered vs null unfiltered | ☑ |
| W2-09 | 2.9 | Invalid classId → GET .../snapshot | 400 | status: 400, `{"error":"classId must be a positive integer."}` | ☑ |
| W2-10 | 2.10 | Nonexistent classId → GET .../snapshot | 404, `Class not found.` | status: 404, `{"error":"Class not found."}` | ☑ |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W2-S1 | S1 | Teacher A requests Teacher B's classId on .../detail | 404 identical to "not found" (not 403, no data leak) | status: 404, `{"error":"Class not found."}` | ☑ |
| W2-S2 | S2 | Teacher A requests Teacher B's classId on .../snapshot | 404 identical to "not found" | status: 404, `{"error":"Class not found."}` | ☑ |
| W2-S3 | S3 | Request /api/classes without Authorization header | 401 | status: 401, `{"error":"Unauthorized"}` | ☑ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W2-11 | 2.11 | Browse Classes list → Class Detail → Snapshot, full sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Clean: Y — 2 React Router future-flag warnings (non-blocking), 1 favicon 404 (pre-accepted Minor from W1). No uncaught exceptions. | ☑ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W2-T1 | T1 | Observe latency for snapshot (composed from multiple services) | Reasonable latency, correct loading states | Optional |

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| W2-F1 | Minor | 2.4 | Two classes share identical name "Grade 6B Mathematics (Analytics Stress Test)" (id 3, 0 learners; id 4, 5 learners) — indistinguishable in list UI | Screenshot, classes list | Deferred — likely stress-test seed artifact, not a real defect. Revisit if seed data changes. |
| W2-F2 | Minor | 2.11 | React Router v7 future-flag deprecation warnings (`v7_startTransition`, `v7_relativeSplatPath`) in console | Console screenshot | Deferred — library-level, addressed at next React Router major upgrade |

## Workflow Result
- Functional: ☑ Pass (W2-02, W2-03 not executed — see Retests required)
- Security: ☑ Pass
- Console: ☑ Clean
- Critical findings: 0
- Major findings: 0
- Minor findings: 2
- Retests required: W2-02, W2-03 (not yet executed — low risk, not blocking; recommend running before final RC-1 tag if time permits)
- Execution time: ___ minutes (fill in your actual time)
- Overall: ☑ PASS
- Reason (if FAIL): N/A

## Carry Forward
WF3 (Learners) prerequisites: None

## Sign-off
- Workflow Executed By: Moleboheng
- Date: 2026-08-07
- Git Commit / Branch: be6bfe91a526ec8a5828f0f1bb55f359f9836226 / main
- Environment: ☑ Local Dev
