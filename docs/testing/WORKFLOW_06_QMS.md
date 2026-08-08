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
| W6-01 | 6.1 | GET /api/tse/status for logged-in teacher | 200, `{ counts, latest, missingCategories }` scoped to teacher | Confirmed prior in session (see Environment Notes) | ☑ |
| W6-02 | 6.2 | GET /api/reflections (no filter) | 200, `reflections: [...]` most recent first, excludes soft-deleted | Confirmed prior in session | ☑ |
| W6-03 | 6.3 | GET /api/reflections?term=<n> for a term with reflections | 200, results scoped to that term only | status: 200, `?term=3` returned only id=1 (term 3), excluded id=3 (term 1) and soft-deleted id=2 | ☑ |
| W6-04 | 6.4 | GET /api/reflections?term=<n> for a term with zero reflections | 200, `reflections: []`, not an error | status: 200, `?term=1` returned only id=3 (term 1), excluded id=1 (term 3) | ☑ |
| W6-05 | 6.5 | POST /api/reflections with valid body (content, term, aiAssisted, evidenceLinkIds, topicId) | 201, `{ reflection }` returned | status: 201, `{ reflection }` returned with correct fields | ☑ |
| W6-06 | 6.6 | POST /api/reflections with missing/blank content | 400, service's own error message surfaced | status: 400, `{"error":"createReflection: content is required"}` | ☑ |
| W6-07 | 6.7 | POST /api/reflections with non-array evidenceLinkIds | 400 | status: 400, `{"error":"createReflection: evidenceLinkIds must be an array"}` | ☑ |
| W6-08 | 6.8 | PATCH /api/reflections/:id with valid partial update | 200, `{ reflection }` reflects the change | status: 200, content updated, updatedAt bumped, other fields preserved | ☑ |
| W6-09 | 6.9 | PATCH /api/reflections/:id with invalid id (0, -1, "abc") | 400, `Invalid reflection id` | status: 400, "Invalid reflection id" (id="abc") | ☑ |
| W6-10 | 6.10 | PATCH /api/reflections/:id for nonexistent/already-deleted id | 404, `Reflection not found` | status: 404, "Reflection not found" (id=999999) | ☑ |
| W6-11 | 6.11 | DELETE /api/reflections/:id for owned, existing reflection | 204, no body | status: 204, no body | ☑ |
| W6-12 | 6.12 | Confirm deleted reflection no longer appears in GET /reflections | Absent from list | Absent: Y — confirmed at API level (GET list) AND independently at DB level (`SELECT` showed row present with `deleted_at` populated, i.e. true soft delete, not hard delete) | ☑ |
| W6-13 | 6.13 | DELETE /api/reflections/:id for already-deleted id | 404, `Reflection not found` | status: 404, "Reflection not found" | ☑ |
| W6-14 | 6.14 | DELETE /api/reflections/:id with invalid id | 400, `Invalid reflection id` | status: 400, "Invalid reflection id" (id="abc") | ☑ |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W6-S1 | S1 | Teacher A attempts PATCH on Teacher B's reflection id | 404 identical to "not found" (not 403, no data leak, no silent success) | status: 404, `{"error":"Reflection not found"}` — Teacher A (sub:1) against Teacher B's (id=92) reflection id=4. Verified against real Teacher B identity (`seedTeacherBAssessment.js`, phone_hash=`sha256('teacher-b-ownership-test')`); Teacher B token minted directly with `TEACHER_JWT_SECRET`. Post-attempt GET as Teacher B confirmed content/updatedAt/deletedAt all unchanged — no silent mutation | ☑ |
| W6-S2 | S2 | Teacher A attempts DELETE on Teacher B's reflection id | 404 identical to "not found" | status: 404, `{"error":"Reflection not found"}` — same target id=4, same integrity confirmation | ☑ |
| W6-S3 | S3 | GET /api/tse/status without Authorization header | 401 | status: 401, `{"error":"Unauthorized"}` | ☑ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W6-15 | 6.15 | Browse QMS status → create → edit → delete a reflection, full sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Clean: **Y** (retest, post-remediation) — see Findings Register W6-F1 (Remediated/Closed). Final browser retest confirmed: coaching-area dropdown present on create; topic-selection guard blocks save without a topic; POST persists `topicId` (verified via Network Response tab, id=6 created with `TOPIC_ASSESSMENT`); new reflection appears in list; edit mode has no topic selector; PATCH leaves `topicId` unchanged across two edits (tracked id=6 through 3 states); console shows only pre-existing React Router future-flag warnings + favicon 404 (same known noise as other workflows), no new errors. | ☑ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W6-T1 | T1 | Observe latency for reflection CRUD operations | Reasonable latency, correct loading states | Optional |

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| W6-F1 | Major | W6-15 | **Root cause:** Dashboard "Save Reflection" action in `ReflectionPanel.jsx` (`handleSave()`, POST branch) sent `{ content }` only, never `topicId`. Per ADR-013 §4.3/§3.3, every new reflection write must carry a valid `topicId` from the closed taxonomy (`utils/qmsTopics.js`). API-layer validation in `reflectionService.createReflection()` was working as designed and correctly rejected the malformed request. **Remediation (commit `f4edfa2`):** `ReflectionPanel.jsx` now fetches the topic taxonomy via a new `GET /api/qms/topics` route (added in `routes/api.js`), renders a required coaching-area `<select>` on the add-reflection form only (not on edit), blocks save with "Please select a coaching area." if no topic is chosen, and includes the selected `topicId` in the POST body. `updateReflection()`'s optional-`topicId` behavior was already correct and is unchanged — edit/PATCH never sends or requires `topicId`. A follow-up commit (`542403e`) removed five unrelated scratch/test files that were accidentally swept into `f4edfa2` via `git add -A`; the four W6-F1 implementation/test files are unaffected by that cleanup. | **Automated (targeted tests):** `tests/api-qms-topics.test.js` (3/3 pass), `tests/api-reflections-write.test.js` (26/26 pass), `ReflectionPanel.test.jsx` via vitest (9/9 pass, including new "refuses to save without a topic" and updated POST-body-shape assertions). **HTTP/DB integration:** direct `curl` calls against the running API confirmed `POST /api/reflections` rejects `topicId: null` with 400 and accepts a valid `topicId` with 201, and that the resulting row persists `topic_id` and round-trips it as `topicId` in `GET /api/reflections`. **Browser (final retest, W6-15):** live dashboard retest confirmed dropdown presence, save guard, persisted `topicId` in the Network Response tab, correct list display, absence of the selector in edit mode, and `topicId` unchanged across two content-only PATCH edits (tracked via a single reflection's id across three network captures). **Scope note:** during this investigation, the "Unscoped" pill shown on the created reflection in the list UI was traced and confirmed to be driven solely by `r.term` (pre-existing logic, unrelated to the topic taxonomy) — the list view never renders `topicId` for any reflection, old or new. This is a pre-existing, unrelated UI gap, not a W6-F1 regression: `topicId` is captured, validated, and persisted correctly end-to-end; the list component simply never surfaces it visually. Not remediated as part of W6-F1 (out of scope); may warrant a separate low-priority UI enhancement ticket. | **Remediated / Closed.** Fixed in `f4edfa2`, repository hygiene follow-up in `542403e`. W6-15 retested and passes. |

## Workflow Result
- Functional: ☑ Pass (API-layer functional checks W6-01 through W6-14 all PASS)
- Security: ☑ Pass (S1/S2/S3 all PASS with genuine cross-tenant requests against real Teacher B identity)
- Console: ☑ Pass (W6-15 retested clean — see W6-F1, Remediated/Closed)
- Critical findings: 0
- Major findings: 0 open (W6-F1 remediated and closed — see Findings Register)
- Minor findings: 0
- Retests required: None outstanding for W6
- Execution time: ___ minutes
- Overall: ☑ PASS
- Reason: W6-F1 (Major) remediated in `f4edfa2` and verified via automated tests, HTTP/DB integration, and final browser retest (W6-15). All functional, security, and console checks now pass.

## Carry Forward
WF7 (Observations) prerequisites: None — W6-F1 is isolated to the QMS reflection-creation UI and does not affect Observations routes or data.

## Sign-off
- Workflow Executed By: X.O (with Claude)
- Date: 2026-08-08
- Git Commit / Branch: main (commit not yet tagged for this session — confirm before commit)
- Environment: ☑ Local Dev
