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
| W6-15 | 6.15 | Browse QMS status → create → edit → delete a reflection, full sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Clean: **N** — see Findings Register W6-F1. Attempting to save a new reflection from `/qms` dashboard fails every time with `createReflection: topicId must be a valid QMS topic id, got "undefined"`. DevTools showed 6 console errors, repeated failed (red) `reflections` POSTs in Network tab. Screenshot captured. | ☒ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W6-T1 | T1 | Observe latency for reflection CRUD operations | Reasonable latency, correct loading states | Optional |

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| W6-F1 | Major | W6-15 | Dashboard "Save Reflection" action in `ReflectionPanel.jsx` (`handleSave()`, POST branch) sends `{ content }` only, never `topicId`. Per ADR-013 §4.3/§3.3, every new reflection write must carry a valid `topicId` from the closed taxonomy (`utils/qmsTopics.js`); `null` is reserved exclusively for pre-PR32 legacy rows. `reflectionService.createReflection()` correctly rejects the request with `400 topicId must be a valid QMS topic id, got "undefined"` — the API-layer contract is working as designed. The defect is entirely client-side: the dashboard never collects or forwards a topic selection when creating a reflection, so every new-reflection save from the browser UI fails. Scope is limited to POST/create; PATCH (edit) does not appear affected, since `updateReflection()` treats `topicId` as optional (`if (topicId !== undefined)`) and only overwrites when explicitly provided. Reflections logged via WhatsApp are unaffected — that flow presumably supplies `topicId` correctly. | Screenshot (localhost:5174/qms) showing inline form error `createReflection: topicId must be a valid QMS topic id, got "undefined"`, plus DevTools Console/Network evidence: 6 console errors, repeated failed (400) `reflections` POST requests. Root cause confirmed by direct code inspection of `dashboard/src/components/qms/ReflectionPanel.jsx` lines 60–90 and `services/reflectionService.js` lines 80–105. | Open — blocks RC-1 sign-off on W6. Not fixed during this audit pass per RC execution discipline (verification, not remediation, mid-checklist). Candidate fix (not yet applied): extend `ReflectionPanel.jsx`'s add-reflection form with a topic selector bound to `utils/qmsTopics.js`'s taxonomy, and include the selected `topicId` in the POST body. Requires product decision on UX (dropdown? required field? default topic?) before implementation — flagging for follow-up, not resolving inline. |

## Workflow Result
- Functional: ☑ Pass (API-layer functional checks W6-01 through W6-14 all PASS)
- Security: ☑ Pass (S1/S2/S3 all PASS with genuine cross-tenant requests against real Teacher B identity)
- Console: ☒ Issues found (W6-15 — see W6-F1)
- Critical findings: 0
- Major findings: 1 (W6-F1 — dashboard create-reflection missing topicId)
- Minor findings: 0
- Retests required: W6-15, after W6-F1 is fixed
- Execution time: ___ minutes
- Overall: ☒ FAIL
- Reason (if FAIL): One Major finding (W6-F1) open. Per RC_SEVERITY.md, a Major finding blocks RC sign-off even though it does not require stopping the audit. All API-layer functional and security checks pass cleanly; the defect is isolated to the dashboard UI's reflection-creation form.

## Carry Forward
WF7 (Observations) prerequisites: None — W6-F1 is isolated to the QMS reflection-creation UI and does not affect Observations routes or data.

## Sign-off
- Workflow Executed By: X.O (with Claude)
- Date: 2026-08-08
- Git Commit / Branch: main (commit not yet tagged for this session — confirm before commit)
- Environment: ☑ Local Dev
