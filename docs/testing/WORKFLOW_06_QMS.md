# Workflow 6: QMS — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W6 – QMS |
| Git Branch | |
| Git Commit | |
| Dashboard Version | |
| API Commit (if different) | |
| Environment | ☐ Local Dev ☐ Staging ☐ Production |
| Executed By | |
| Date | |

## Implementation Coverage
No dedicated `/qms/*` route exists yet — this workflow audits the QMS
**user workflow** as currently implemented across two route groups:
- `GET /api/tse/status` — `tseEvidenceService.getStatusSnapshot(phoneHash)`, returns `{ counts, latest, missingCategories }` scoped to the teacher.
- `GET /api/reflections` (optional `?term=<n>`), `POST /api/reflections`, `PATCH /api/reflections/:id`, `DELETE /api/reflections/:id` — `reflectionService` CRUD, soft-delete only (ADR-011 §7 — never a hard DELETE).
- `classSnapshotService`'s `qms` section (exercised in Workflow 2) is currently always `"unavailable"` per ADR-014 §3.4 — this is a known, correct current state, not a gap to flag here.

## Preconditions
- Logged-in teacher session (Workflow 1 passed).
- Test teacher has some existing TSE evidence links (for non-empty
  `counts`/`latest` in the status snapshot).
- Test teacher has ≥1 existing reflection to edit/delete, and knows a
  term with zero reflections (for `?term=` filtering).
- A second teacher's reflection ID is known, to test ownership scoping
  on PATCH/DELETE.

## Environment Notes
- `DELETE /reflections/:id` is a soft delete — confirm the row still
  exists in the DB with `deleted_at` (or equivalent) set, not physically
  removed, and confirm it no longer appears in subsequent `GET
  /reflections` calls.
- `createReflection`/`updateReflection` surface their own validation
  errors as 400 via a message-prefix check (`^createReflection:` /
  `^updateReflection:`) rather than a separate validation layer — any
  validation error not matching that prefix pattern will fall through
  to a 500 instead of 400. Worth probing directly.

## Stop Conditions
**Critical:**
- `PATCH`/`DELETE /reflections/:id` succeeds against another teacher's
  reflection (must be 404, not silently succeed or 403)
- `GET /tse/status` or `GET /reflections` returns another teacher's data
- A "deleted" reflection still appears in a subsequent `GET /reflections`
  call, or a hard delete is observed instead of soft delete
- Server 500 on any of the five endpoints for a valid, owned request
- Uncaught console exception while browsing QMS status or managing
  reflections

**Non-blocking:** cosmetic UI, spinner/timing, copy, minor layout.

## Functional Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W6-01 | 6.1 | GET /api/tse/status for logged-in teacher | 200, `{ counts, latest, missingCategories }` scoped to teacher | status: ___ | ☐ |
| W6-02 | 6.2 | GET /api/reflections (no filter) | 200, `reflections: [...]` most recent first, excludes soft-deleted | status: ___ · count: ___ | ☐ |
| W6-03 | 6.3 | GET /api/reflections?term=<n> for a term with reflections | 200, results scoped to that term only | status: ___ | ☐ |
| W6-04 | 6.4 | GET /api/reflections?term=<n> for a term with zero reflections | 200, `reflections: []`, not an error | status: ___ | ☐ |
| W6-05 | 6.5 | POST /api/reflections with valid body (content, term, aiAssisted, evidenceLinkIds, topicId) | 201, `{ reflection }` returned | status: ___ | ☐ |
| W6-06 | 6.6 | POST /api/reflections with missing/blank content | 400, service's own error message surfaced | status: ___ | ☐ |
| W6-07 | 6.7 | POST /api/reflections with non-array evidenceLinkIds | 400 | status: ___ | ☐ |
| W6-08 | 6.8 | PATCH /api/reflections/:id with valid partial update | 200, `{ reflection }` reflects the change | status: ___ | ☐ |
| W6-09 | 6.9 | PATCH /api/reflections/:id with invalid id (0, -1, "abc") | 400, `Invalid reflection id` | status: ___ | ☐ |
| W6-10 | 6.10 | PATCH /api/reflections/:id for nonexistent/already-deleted id | 404, `Reflection not found` | status: ___ | ☐ |
| W6-11 | 6.11 | DELETE /api/reflections/:id for owned, existing reflection | 204, no body | status: ___ | ☐ |
| W6-12 | 6.12 | Confirm deleted reflection no longer appears in GET /reflections | Absent from list | Absent: Y/N | ☐ |
| W6-13 | 6.13 | DELETE /api/reflections/:id for already-deleted id | 404, `Reflection not found` | status: ___ | ☐ |
| W6-14 | 6.14 | DELETE /api/reflections/:id with invalid id | 400, `Invalid reflection id` | status: ___ | ☐ |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W6-S1 | S1 | Teacher A attempts PATCH on Teacher B's reflection id | 404 identical to "not found" (not 403, no data leak, no silent success) | status: ___ | ☐ |
| W6-S2 | S2 | Teacher A attempts DELETE on Teacher B's reflection id | 404 identical to "not found" | status: ___ | ☐ |
| W6-S3 | S3 | GET /api/tse/status without Authorization header | 401 | status: ___ | ☐ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W6-15 | 6.15 | Browse QMS status → create → edit → delete a reflection, full sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Clean: Y/N | ☐ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W6-T1 | T1 | Observe latency for reflection CRUD operations | Reasonable latency, correct loading states | Optional |

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
WF7 (Observations) prerequisites: ___ (or "None")

## Sign-off
- Workflow Executed By: __________
- Date: __________
- Git Commit / Branch: __________
- Environment: ☐ Local Dev ☐ Staging ☐ Production
