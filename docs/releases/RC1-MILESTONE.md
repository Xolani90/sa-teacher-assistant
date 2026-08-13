# RC1 Milestone — Release Candidate 1

**Document Version:** 1.6
**Last Updated:** 2026-08-12
**Approved By:** _pending_

**RC1 Target Version:** v1.0.0-rc1
**Status:** Draft — not yet started
**Owner:** X.O
**Type:** Execution checklist, not an architectural document. No new ADRs against this file — see the Feature Freeze rule below.

### Candidate progression

```
v1.0.0-rc1
    ↓
Critical/High fixes only (from Phase A/B/C findings)
    ↓
v1.0.0-rc2  (only cut if RC1 fails its Go/No-Go — see below)
    ↓
Pilot verification
    ↓
v1.0.0
```

If Phase A, B, or C surfaces Critical or High defects that require a new
build, the next build is `v1.0.0-rc2`, not another draft of RC1. This
avoids ever having to guess later whether a given pilot build "still counts"
as RC1.

---

## Goal

Ship RC1 to 5–10 pilot teachers.

**Feature freeze:** no new features unless they fix a blocker discovered
during validation. This document answers one question: *what exactly must
be true before the first real teacher can use this?*

**No new ADRs during RC1** unless they address a production defect or
security issue. Architectural exploration resumes only after RC1 is
complete. If you find yourself drafting an ADR for something that isn't a
defect fix, that's the signal to stop and put the idea in the RC2 Backlog
instead.

**Database freeze:** no schema changes during RC1 unless required to fix a
critical defect, a security issue, or data corruption. All other schema
work moves to RC2.

**Public API freeze:** no breaking API changes during RC1. Only additive
changes or production bug fixes are permitted — this protects the
not-yet-built dashboard/mobile work that will eventually consume this API.

**Documentation freeze:** only corrections or production-related updates
(deployment notes, runbooks, this document) may be made during RC1. New
architecture documents belong to RC2 — don't let "improving the docs"
become a side door back into design work.

**Dependency freeze:** no routine package upgrades during RC1. Exceptions:
security fixes and fixes for a production blocker. Routine updates
(Express, the AI SDK, the WhatsApp SDK, etc.) move to RC2 — an upgrade is
exactly the kind of change that can introduce a regression nobody was
looking for.

**Code freeze:** once `v1.0.0-rc1` is tagged, only commits that reference
a documented Defect Log entry are permitted. No unrelated cleanup,
refactors, or "while I'm in here" commits — if it isn't fixing a logged
RC1 defect, it waits for RC2.

---

## Rollback Conditions

Immediately suspend the pilot if any of these occur — no judgment call, no
waiting to see if it happens again:

- Data corruption
- Payment duplication
- Authentication bypass
- Security breach
- Database integrity failure

---

## Phase A — Functional Verification

**Phase A exits only when:**
- ✓ Every checklist item below is marked Pass
- ✓ No High or Critical defects remain open from anything found while testing

**Phase A Result**
- [ ] PASS
- [ ] FAIL
Date: _______  Approved by: _______
Notes:

Every command below gets walked manually against a real WhatsApp number and
marked Pass / Fail, with notes on anything odd even if it technically
passed. Automated test file is listed for reference — green tests don't
substitute for the manual pass, since WhatsApp formatting and real API
round-trips aren't covered by unit tests.

### Core onboarding & auth

**Note:** The first two authentication checks are API-level verification,
not WhatsApp manual tests. Validate via HTTP client (curl/Postman). The
dashboard is the intended consumer and is deferred to RC2, but the backend
authentication endpoints remain part of the RC1 release surface and should
be verified independently.

| Item | Automated ref | Pass | Fail | Notes |
|---|---|---|---|---|
| WhatsApp OTP login (request-code → verify-code) | `pr22-whatsapp-otp.test.js` | ☐ | ☐ | Verify via API (curl/Postman); no WhatsApp trigger exists |
| Dev OTP bypass correctly disabled in production | `pr25-dev-otp-bypass.test.js` | ☐ | ☐ | Verify via API against production |
| Profile update | `update-teacher-profile.test.js` | ☐ | ☐ | |
| MENU / HELP / HI (session reset) | `menu-help-session-reset.test.js` | ☐ | ☐ | |
| STOP (opt-out) | `menu-help-session-reset.test.js` | ☐ | ☐ | |

### Teaching — content generation
| Item | Automated ref | Pass | Fail | Notes |
|---|---|---|---|---|
| WORKSHEET | `test.js`, `pdf-rendering.test.js` | ☐ | ☐ | |
| TEST (with memo) | `test.js` | ☐ | ☐ | |
| EXPLANATION | `test.js` | ☐ | ☐ | |
| LESSON PLAN | `test.js` | ☐ | ☐ | |
| ATP / Annual Teaching Plan | `test-atp.js`, `test-atp-topic-alignment.js` | ☐ | ☐ | |
| PRINT (blueprint paper) | `assessment-session-print.test.js` | ☐ | ☐ | |
| SAVE generated content | `phase-b2/3/4/5-*.test.js` | ☐ | ☐ | |
| CANCEL pending save | `cancel-pending-save.test.js` | ☐ | ☐ | |
| MY RESOURCES | `workspace.test.js` | ☐ | ☐ | |

### Assessment
| Item | Automated ref | Pass | Fail | Notes |
|---|---|---|---|---|
| NEW TEST (session start → blueprint → class) | `assessment-session-flow.test.js` | ☑ | ☐ | PASS — RC1-H-001 Resolved (2026-08-12). `NEW BLUEPRINT` conversational authoring live-verified end-to-end on WhatsApp (happy path, CAPS-rejection + FIX retry, CANCEL, STATUS — the last of which surfaced and required RC1-H-004, now also Resolved), publishing straight into the existing `NEW TEST` entry point tested below. `assessment-session-flow.test.js`'s automated suite (34/34) still reflects the pre-blueprint-authoring seeded-workaround scenario and has not been rewritten to assert against `NEW BLUEPRINT` itself (flow-layer coverage for that lives in `blueprintAuthoringFlow.test.js`, 41/41) — noted here since RC1-H-004 demonstrated flow-layer tests alone don't guarantee real dispatch behavior; the ☑ above reflects the live-verified result, not this file's own suite. Original workaround note retained for history: manually seeded blueprint via `scripts/seedTestBlueprint.js` confirmed `NEW TEST` found "Fractions Test (Seed)" and captured marks for 5/5 learners successfully in WhatsApp. Remaining Assessment rows below were tested under that same workaround before RC1-H-001 closed. |
| Interactive mark capture | `assessment-capture-service.test.js` | ☑ | ☐ | PASS under RC1-H-001 workaround — captured marks for all 5 learners (4 questions each) via WhatsApp reply-with-marks flow without error. |
| Bulk paste mark capture | `assessment-bulk-capture.test.js` | ☑ | ☑ | PASS — RC1-M-001 Resolved (2026-08-04). Tested under RC1-H-001 workaround via live WhatsApp: a paste with per-question marks exceeding the blueprint's actual max (all 4 questions max 5) was correctly rejected by `adaptParsedMarks()`, but the teacher only saw a generic "No learners could be captured" message — the specific per-learner reasons (`adaptParsedMarks()` already computes them) were silently discarded. Fixed in `flows/assessmentSessionFlow.js` (new `formatBulkFailureDetail()` helper, wired into the `!result.ok` branch) so the specific skip reasons now reach WhatsApp. See Defect Log. |
| UNDO / EDIT mid-capture | `assessment-capture-undo.test.js`, `assessmentCaptureService.edit.test.js` | ☐ | ☐ | |
| Upload marks (CSV/text) | `test-marks-parser.js`, `parsed-marks-adapter.test.js` | ☐ | ☐ | |
| Item analysis / blueprint analytics | `blueprint-analytics.test.js` | ☑ | ☑ | PASS — RC1-H-002 Resolved (2026-08-04). Fix verified via automated tests (`intervention-reports.test.js` 11/11, `blueprint-analytics.test.js` 21/21) and a fresh live WhatsApp run (new seed, 5 learners): Intervention Report now shows "Common Fractions — 60% of learners affected" (3 of 5 learners, ≤100%) and "Target group size: 3 learners" (Group C + Group D), replacing the original 140%/0-learners bug. See Defect Log for full root cause and verification history. |
| CLASS INTERVENTION | `workspaceFlow-classIntervention.test.js` | ☐ | ☐ | |
| CLASS INTERVENTION PDF | `workspaceFlow-classInterventionPdf.test.js` | ☐ | ☐ | |
| LEARNER PROGRESS | `masteryService.test.js`, `routing-order-workspace-flow.test.js` | ☐ | ☐ | |
| LEARNER PROGRESS PDF | `workspaceFlow-learnerProgressPdf.test.js` | ☐ | ☐ | |

### Coaching (QMS)
| Item | Automated ref | Pass | Fail | Notes |
|---|---|---|---|---|
| MY COACHING (recommendation output) | `coachingEngineService.test.js`, `coachingMessageRenderer.test.js` | ☐ | ☐ | |
| REFLECT | `reflectionFlow.test.js` | ☐ | ☐ | |
| NEW GOAL | `growthPlanFlow.test.js` | ☐ | ☐ | |
| Snapshot generation (on reflect/goal events) | `coachingSnapshotService.test.js` | ☐ | ☐ | |
| Trend-based recommendations (rising/falling) | `coachingTrendService.test.js` | ☐ | ☐ | |
| MY STATS / MY STATS ALL | `qmsAnalyticsService.test.js` | ☐ | ☐ | |
| MY GOALS | `qmsAnalyticsService.test.js` | ☐ | ☐ | |
| MY REFLECTIONS | `reflectionService.test.js` | ☐ | ☐ | |

### Workspace
| Item | Automated ref | Pass | Fail | Notes |
|---|---|---|---|---|
| MY CLASSES / WORKSPACE | `workspace.test.js` | ☐ | ☐ | |
| NEW CLASS | `workspace.test.js` | ☐ | ☐ | |
| ROSTER (paste, merge, replace) | `roster-flow.test.js` | ☐ | ☐ | |
| ADD LEARNER / REMOVE LEARNER / CLEAR ROSTER | `roster-flow.test.js` | ☐ | ☐ | |
| MY ASSESSMENTS | `workspace.test.js` | ☐ | ☐ | |
| MY PROGRESS | `progressService.test.js` | ☐ | ☐ | |

### Observations / portfolio
| Item | Automated ref | Pass | Fail | Notes |
|---|---|---|---|---|
| Observation capture (incremental) | `observation-smoke-test.js` | ☐ | ☐ | |
| MY OBSERVATIONS / detail view | `observation-smoke-test.js` | ☐ | ☐ | |
| ADD NOTE | `observationFlow-corrections-delete-resolve-incremental.test.js` | ☐ | ☐ | |
| CORRECT / DELETE / RESOLVE | `observationRepository-corrections-delete-resolve.test.js` | ☐ | ☐ | |
| Follow-up summary | `observationFlow-followup.test.js` | ☐ | ☐ | |

### Payments
| Item | Automated ref | Pass | Fail | Notes |
|---|---|---|---|---|
| Yoco payment → Pro upgrade | `phase-d-payment-renewal.test.js` | ☐ | ☐ | |
| Duplicate/replayed webhook idempotency | `phase-d-replay-stress.test.js` | ☐ | ☐ | |
| Stacked renewals extend correctly | `phase-d-payment-renewal.test.js` | ☐ | ☐ | |

---

## Phase B — Production Readiness

**Phase B exits only when:**
- ✓ Every Security and Infrastructure item below is checked
- ✓ No Critical or High severity defect remains open in production readiness

**Phase B Result**
- [ ] PASS
- [ ] FAIL
Date: _______  Approved by: _______
Notes:

### Security
- [ ] WhatsApp webhook signature validation
- [ ] Yoco webhook signature validation
- [ ] JWT secrets configured (`TEACHER_JWT_SECRET`)
- [ ] Environment variables verified against `validateEnv.js`
- [ ] No secrets committed to git history
- [ ] Rate limiting verified (`/api`, `/api/auth`)
- [ ] Admin endpoints protected (`requireAdminSecret`, not reachable via `/api`)
- [ ] Webhook secrets verified (Yoco `whsec_` format, replay-window rejection)
- [ ] Production logs redact phone numbers (dev-only OTP logging confirmed gated off `NODE_ENV=production`)
- [ ] Tokens and secrets never appear in logs
- [ ] Stack traces / raw DB errors never returned to the client in production

### Infrastructure
- [ ] Database backups tested
- [ ] Restore-from-backup tested at least once
- [ ] DB migrations verified (apply cleanly on fresh DB, idempotent on re-run)
- [ ] `DB_PATH` set to a persistent disk in production (the `[DB] ⚠️ DB_PATH is not set` warning never fires there)
- [ ] Monitoring enabled (Sentry `SENTRY_DSN` set and confirmed receiving events)
- [ ] Error logging verified end-to-end (a forced error actually shows up in the monitoring dashboard)

---

---

## Deployment Verification

Verifies the deployment itself, not just the code — a surprisingly common
place for releases to fail even when everything above has passed.

- [ ] Clean production deployment completed (from a clean `main` checkout)
- [ ] Health endpoint returns OK
- [ ] WhatsApp webhook connected and verified against the production URL
- [ ] Yoco payment webhook connected and verified against the production URL
- [ ] Database migration completed successfully on the production database
- [ ] Smoke test completed after deployment (at minimum: one full command from each Phase A category, run against production)

**Deployment Result**
- [ ] PASS
- [ ] FAIL
Date: _______  Approved by: _______
Notes:

---

## Rollback Procedure

Rollback Conditions (above) say *when* to stop. This says *how*.

1. Disable the incoming WhatsApp webhook.
2. Restore the previous known-good deployment.
3. Restore the database from backup if corruption occurred.
4. Notify pilot teachers.
5. Open a Critical incident report (what happened, when, what was restored).
6. Resume the pilot only after a fresh RC1 Approval Meeting.

---

## Phase C — Pilot

**Phase C exits only when:**
- ✓ The full 14-day duration has elapsed
- ✓ All success metrics below are met
- ✓ No Rollback Condition was triggered (or, if one was, it was resolved and the pilot restarted with a documented decision)

**Phase C Result**
- [ ] PASS
- [ ] FAIL
Date: _______  Approved by: _______
Notes:

**Pilot size:** 5–10 teachers
**Duration:** 14 days

**Early termination:** if a Rollback Condition (above) occurs at any
point during the 14 days, the pilot ends immediately — day 1 or day 13,
no difference. After the fix, the replacement RC starts a fresh 14-day
pilot from day 1. Partial pilot time is never carried over, since the
fix itself is what's unverified.

### Success metrics
- [ ] ≥95% successful command completion rate
- [ ] No data corruption
- [ ] No duplicated resources (e.g. double-saved worksheets, double-charged payments)
- [ ] No crashes
- [ ] Average response time <10 seconds
- [ ] Teachers complete real work without assistance from you

### Pilot operations
- [ ] Pilot teachers selected
- [ ] Onboarding materials/process complete
- [ ] Feedback channel active (WhatsApp group, form, etc.)
- [ ] Bug triage process defined (who reviews reports, how often)
- [ ] Daily review cadence established during the 14 days

---

## Phase D — RC1 Lock

**Only fixes are allowed during the pilot.**

A fix must satisfy **both**:
- Reported by a pilot teacher, **and**
- Reproducible

Otherwise: defer to RC2. No exceptions made in the moment — if it doesn't
meet both conditions, it goes in the RC2 Backlog below, not into the code.

---

## Defect Log

Every defect discovered during RC1 (Phase A, B, or C) must record all five
fields below when opened, and stay in this table until resolved. This is
what answers "who was fixing this again?" six days into the pilot.

| Severity | Owner | Date discovered | Date resolved | RC version containing fix | Description |
|---|---|---|---|---|---|
| High | X.O | 2026-08-04 | 2026-08-12 | Resolved | **RC1-H-001** — No teacher-accessible production path exists to create and publish Assessment Blueprints. `createBlueprint()`/`publishBlueprint()` (`services/blueprintRepository.js`) have no caller outside `scripts/seedTestBlueprint.js` (a dev seeding script) and the test suite. Verified no path via: AI intent classifier (no blueprint-creation intent type), fixed WhatsApp commands (`NEW TEST`, `PRINT` both require an existing published blueprint), `routes/api.js` (zero blueprint references; its only POST/PATCH/DELETE routes are `/reflections`, unrelated), `routes/webhook.js` (only imports read-only `listBlueprints`/`getBlueprintById`), `flows/assessmentSessionFlow.js` (only reads via `listBlueprints`), `core/` (no blueprint references), and no cron/scheduler exists. Impact: `NEW TEST` and everything downstream (PRINT, interactive/bulk mark capture, UNDO/EDIT, item analysis, CLASS INTERVENTION, LEARNER PROGRESS) is unreachable for a pilot teacher on RC1 as shipped. The blueprint subsystem itself (validation, versioning, marks import, analytics, PDF export) is fully implemented and tested — only the production entry point to create/publish is missing.<br><br>**Scope approved (2026-08-12):** conversational `NEW BLUEPRINT` authoring entirely from WhatsApp — header fields (title/subject/grade/term/total marks) one turn each, questions added one at a time (`<topic> | <max marks>`, or `<question number> | <topic> | <max marks>`), a REVIEW step before commit, and PUBLISH going through the existing `publishBlueprint()` CAPS validation unchanged. No optional question fields (subtopic/bloomLevel/atpReference/expectedMisconception), no revision UX, no archive/delete UX, no mid-question editing (CANCEL + restart), no bulk/CSV import, no AI-assisted question generation — all explicitly deferred.<br><br>**Implementation (2026-08-12):** new `flows/blueprintAuthoringFlow.js`, mirroring `flows/assessmentSessionFlow.js`'s exact shape (`STEP` enum + SQLite-backed `SessionStore('blueprintAuthoring', 30min)` + NavigationService CANCEL/STATUS delegation via `registerFlow()`). State machine: `HEADER_TITLE → HEADER_SUBJECT → HEADER_GRADE → HEADER_TERM → HEADER_TOTAL_MARKS → ADD_QUESTION (loop) → REVIEW → PUBLISHED_MENU`. Nothing is written to `assessment_blueprints`/`blueprint_questions` until the teacher replies PUBLISH from REVIEW (`createBlueprint()` is called there for the first time) — an abandoned session before that point leaves zero DB rows. A publish rejected by CAPS validation (`err.unresolvedTopics`) keeps the session at REVIEW rather than restarting it: the teacher can reply `FIX <question number> <new topic>` to retype just the affected question(s) (persisted immediately via `updateQuestion()` against the draft row `createBlueprint()` already wrote) and then PUBLISH again, which re-uses the same `blueprintId` rather than creating a duplicate draft. On success, a `PUBLISHED_MENU` step (mirroring `assessmentSessionFlow`'s `COMPLETE_MENU`) offers NEW TEST / PRINT, dispatching straight into `assessmentSessionFlow`'s existing handlers.<br><br>**Discovered scope expansion during implementation:** `routes/webhook.js` only builds the deps object — the actual flow dispatch lives in `core/messageProcessor.js`, in two ordered `if (await deps.handleXFlow(...)) return;` lists (the `alreadyMidFlow` fast-path and the classified-intent path) plus an `activeFlowId` check gating `alreadyMidFlow`. All three needed the same additive, position-matched entries `handleAssessmentSessionFlow` already has, so `core/messageProcessor.js` was added to scope alongside the two originally-approved files (`routes/webhook.js`, this milestone doc) — reported and implemented as additive-only, no restructuring, no risk to other flows' dispatch order.<br><br>**Files changed:** new `flows/blueprintAuthoringFlow.js`, new `tests/blueprintAuthoringFlow.test.js`; modified `routes/webhook.js` (new `blueprintAuthoringState` SessionStore, `registerFlow('blueprintAuthoring', ...)`, `buildBlueprintAuthoringDeps()`, wired into `buildProcessMessageDeps()`), `core/messageProcessor.js` (additive dispatch entries in both ordered lists + the `activeFlowId` check), this milestone doc. `services/blueprintRepository.js`, `services/blueprintTopicValidation.js`, `utils/sessionStore.js`, `services/navigationService.js` all reused as-is, unmodified.<br><br>**Open question, not decided:** `createBlueprint()` does not cross-check that `totalMarks` equals the sum of question `maxMarks` — this flow doesn't add that validation either (teacher self-reports both, matching current repository behaviour). Flagged for a future decision, not blocking this fix.<br><br>**Verification performed (2026-08-12):** flow-layer automated tests (`tests/blueprintAuthoringFlow.test.js`, 41/41 assertions passing) covering the full happy path through publish, invalid input at every header step, CANCEL (zero DB rows before PUBLISH), STATUS, the CAPS-rejection → `FIX` → re-publish path (confirms `createBlueprint()` is called exactly once even across a failed-then-retried publish), zero-questions `DONE` rejection, and session survival across a simulated process restart (state round-tripped through the same `SessionStore` contract). Repository-layer behaviour (`createBlueprint`/`publishBlueprint`/CAPS validation itself) is unchanged and already covered by the existing 26 tests in `tests/migration-029-blueprint-repository.test.js`, deliberately not duplicated here.<br><br>**Live WhatsApp verification (2026-08-12):** full conversational `NEW BLUEPRINT` flow run end-to-end against the deployed teacher-facing WhatsApp number (Render). Confirmed: (1) **Happy path** — title → subject → grade → term → total marks → two questions → REVIEW → PUBLISH → published menu (NEW TEST / PRINT), matching the flow exactly. (2) **CAPS-rejection + FIX retry** — a Grade 9 Mathematics blueprint with one valid topic ("Algebraic equations") and one invalid topic ("Quantum Mechanics") correctly failed PUBLISH with a "Did you mean" suggestion list drawn from the real CAPS registry; `FIX 2 Algebraic equations` updated the question and a retried PUBLISH succeeded, confirming `createBlueprint()` fires exactly once even across a failed-then-retried publish. (3) **CANCEL mid-flow** — correctly cancelled with "Nothing was saved," confirming zero DB rows before PUBLISH holds in production, not just in the test double. (4) **STATUS mid-flow** — surfaced a real, three-layer production defect not caught by flow-level tests (which call handlers directly and bypass the real dispatch chain); see **RC1-H-004** for full root cause and fix. Once RC1-H-004 was resolved, STATUS sent mid-flow (after the Term prompt) correctly returned "Session status: *Status test 3* — waiting for the term (or SKIP)," confirming the flow's own STATUS branch — written correctly from the start — finally reaches the teacher. (5) Restart guard's PUBLISHED_MENU exception (typing NEW BLUEPRINT immediately after a successful PUBLISH starts a fresh session rather than refusing) also confirmed live.<br><br>**Not yet live-tested:** zero-question DONE rejection, and the restart guard's refusal path (NEW BLUEPRINT while genuinely mid-flow, before PUBLISHED_MENU) — both covered by `blueprintAuthoringFlow.test.js` at the flow layer, but not yet exercised against the real dispatch chain the way STATUS was, which is what surfaced RC1-H-004. Given RC1-H-004 demonstrated that flow-layer test coverage does not guarantee a command reaches its intended handler once real dispatch order and `commandHandler.js` are involved, these two remain worth a live pass before treating this as fully closed — tracked as a follow-up spot-check, not a blocker, since NEW BLUEPRINT and DONE are not global commands `commandHandler.js` intercepts (only STATUS/USAGE/BALANCE and CANCEL-of-a-SAVE-prompt are). Status: **Resolved.** |
| High | X.O | 2026-08-04 | 2026-08-04 | Resolved | **RC1-H-002** — Assessment intervention analytics produce incorrect results. Tested under the RC1-H-001 workaround (manually seeded blueprint "Fractions Test (Seed)", Grade 6 Mathematics, 5 learners, marks captured via `NEW TEST` in WhatsApp): the generated Intervention Report shows "Common Fractions" and "Whole Numbers" both at 140% of learners affected — impossible with 5 learners (max is 100%) — and separately states "Target group size: 0 learners," while the accompanying Blueprint Assessment Report PDF correctly identifies 2 learners below the 40% support threshold (Samuel Tshabalala 20%, Motlatsi Moloi 0%). Impact: a teacher could be shown a report that simultaneously flags a topic-wide problem and recommends acting on zero learners, producing incorrect instructional guidance.<br><br>**Root cause analysis (2026-08-04):**<br>1. `services/errorAnalysisService.js` (line 155) counts question failures rather than unique affected learners when aggregating by topic: `topicErrors[topic].frequency` accumulates a per-question failure tally and sums across every question sharing a topic, so a learner failing multiple questions under one topic is counted more than once. With 2 questions per topic in the seeded blueprint, this allows "learners affected" percentages to exceed 100%.<br>2. `services/interventionReportsService.js` (lines 158, 229) reads `report.interventionPlan.targetGroups` (plural, expecting an array), but `services/interventionPlanService.js` (line 76) returns the field as `targetGroup` (singular, a pre-formatted string). The property name mismatch means `targetGroups` is always `undefined`, silently falling back to an empty array via `|| []`, producing a target group size of 0 even though correct group/count data (Group C: 2, Group D: 2) exists under the correctly-named field.<br><br>**Fix implemented (2026-08-04):**<br>1. `errorAnalysisService.js`'s `performErrorAnalysis()` now tracks a `Set` of unique affected learner names per topic (parsing each learner's `question_data` the same way `itemAnalysisService.js` does, using the same half-marks-per-question threshold), rather than summing per-question failure counts. `frequency` is now that Set's size, so it can never exceed the class size.<br>2. `interventionPlanService.js`'s `generateInterventionPlan()` now returns `targetGroups` (the array) alongside the existing `targetGroup` (the display string), so `interventionReportsService.js`'s existing read of `targetGroups` resolves correctly instead of silently defaulting to an empty array.<br><br>**Verification performed:** standalone reproduction of the exact seeded scenario (5 learners, 2 questions per topic, matching the captured marks and Group A–D distribution from the WhatsApp session) confirmed the old formula reproduces 140%/0-learners exactly as observed in production, and the fixed formula produces 80% (≤100%, unique-learner-based) and 4 learners (Group C + Group D, correctly read). **Final verification (2026-08-04):** (1) Automated tests run directly via `node` (working around a sandboxed `npm install` block on an unrelated `xlsx`/`better-sqlite3` dependency): `tests/intervention-reports.test.js` 11/11 passed, `tests/blueprint-analytics.test.js` 21/21 passed, no regressions in any other suite that could execute without the missing native module. (2) Fresh live WhatsApp run against a newly seeded "Fractions Test (Seed)" assessment (5 learners, marks captured via `NEW TEST`, different data from the original bug report): the generated Intervention Report shows "Common Fractions — 60% of learners affected" (3 of 5 learners — correctly ≤100%, no repeat of the 140% bug) and "Target group size: 3 learners" (Group C: 2 + Group D: 1, correctly read — no repeat of the 0-learners bug). Status: **Resolved.** |
| High | X.O | 2026-08-12 | 2026-08-12 | Resolved | **RC1-H-003** -- `POST /request-code` could fail because `deleteExpiredCodes(phoneHash)`, called immediately before OTP generation in `routes/auth.js`, physically deletes `auth_codes` rows that `whatsapp_delivery_events.auth_code_id` references via a foreign key with no `ON DELETE` clause. Impact: a phone with delivery-event history against an expired/consumed OTP could not request a new code (`request-code` errored instead of returning the generic 200), blocking re-authentication.<br><br>**Investigation (2026-08-12):** repository-wide impact analysis confirmed no production logic depends on physical deletion of `auth_codes` rows for correctness -- OTP validity/supersession are entirely predicate-based (`consumed_at`, `expires_at`, `superseded_at`), lockout/cooldown live independently in `auth_phone_state`, and no retention requirement exists anywhere in the codebase. Removing the `deleteExpiredCodes()` hot-path call therefore removes the FK violation with no schema change. However, a regression test written to prove the fix surfaced a second, closely related defect: `idx_auth_codes_active_backstop` (Migration 041) is a partial unique index enforcing "at most one non-consumed, non-superseded row per `phone_hash`," and -- because SQLite partial indexes cannot reference `datetime('now')` -- it does not itself exclude merely-expired rows. Without `deleteExpiredCodes()` clearing them, an expired-but-not-yet-superseded row continued to occupy that slot indefinitely, so the subsequent `INSERT` of the replacement OTP failed with `UNIQUE constraint failed: auth_codes.phone_hash`.<br><br>**Root cause, full picture:** `deleteExpiredCodes()` was silently doing two jobs -- (1) avoiding the FK violation, and (2) vacating the active-OTP backstop slot for the next `INSERT`. Removing it without a replacement for job (2) traded one failure mode for another.<br><br>**Fix implemented:** rather than reintroducing physical deletion, `generateAuthCodeTransactionally()`'s existing supersession step (`services/authCodeRepository.js`) was broadened to also retire (`superseded_at = datetime('now')`) an old OTP that has already expired, not only one still active at generation time. This makes the OTP-generation transaction itself responsible for vacating the backstop slot, rather than relying on a separate destructive cleanup call. `superseded_at`'s documented meaning was correspondingly widened from "an active OTP was replaced by a newer OTP" to "an OTP ceased to be eligible as the current OTP because a newer OTP generation retired it, whether or not it had already expired" -- a strict, additive broadening (every previously-superseded case remains superseded for the same reason; the change only adds new cases). Read-only analysis (2026-08-12) confirmed no production code, test, or documented contract depends on the narrower meaning, and that `getActiveAuthCode()`, `consumeAuthCode()`, lockout, and cooldown are all unaffected, since they key off `expires_at`/`consumed_at`/`auth_phone_state` independently of `superseded_at`'s cause.<br><br>**Explicitly out of scope / unchanged:** the `whatsapp_delivery_events` foreign key, `idx_auth_codes_active_backstop` (index left byte-identical), OTP expiry (5 minutes), resend cooldown (60s), lockout policy (5 attempts / 15 minutes), verification behavior, the generic-200 anti-enumeration response, and the public API contract. No schema migration, no `ON DELETE CASCADE`/`SET NULL`, no data retention policy was introduced. Unbounded `auth_codes` row growth (now that rows are never physically removed) is accepted for RC1 and deferred to RC2 as a separate, narrowly-scoped retention/archival decision.<br><br>**Verification performed (2026-08-12):** `tests/authCodeRepository.test.js` 49/49 passing, `tests/pr22-whatsapp-otp.test.js` 56/56 passing. **Production verification (2026-08-12):** confirmed live against deployed Render instance — `/healthz` 200, a genuinely expired auth-code row observed to transition to superseded (not deleted) on next `request-code` call, `whatsapp_delivery_events` history for that row preserved intact, no FK or UNIQUE constraint failure. Full findings recorded in `docs/testing/PRODUCTION_VERIFICATION_FINDINGS_2026-08-11.md`. Status: **Resolved.** |
| High | X.O | 2026-08-12 | 2026-08-12 | Resolved | **RC1-H-004** — `STATUS` sent while mid-flow in `blueprintAuthoringFlow` (RC1-H-001) did not reach that flow's own STATUS handler. Discovered during RC1-H-001's live verification pass. Not caught by any automated test because `blueprintAuthoringFlow.test.js` and `assessment-session-flow.test.js` call their flow handlers directly, bypassing the real dispatch chain (`routes/webhook.js` → `core/messageProcessor.js` → `core/commandHandler.js` → flow handlers) entirely — meaning this defect could only ever surface live, not in the test suite as currently structured.<br><br>**Root cause, three layers, found and fixed incrementally as each was uncovered live:**<br>1. `core/commandHandler.js`'s global `STATUS`/`USAGE`/`BALANCE` handler runs unconditionally in `messageProcessor.js` *before* the `alreadyMidFlow` dispatch that would route to a flow's own STATUS branch. It had zero awareness of any flow's session state, so it always intercepted first and replied with subscription/usage info instead.<br>2. Fixing (1) alone surfaced a second layer: `flows/assessmentSessionFlow.js` is checked before `flows/blueprintAuthoringFlow.js` in `messageProcessor.js`'s dispatch order, and its own no-session branch unconditionally claimed `STATUS`/`RESUME` ("No active assessment session found...") with no awareness of `blueprintAuthoringState` either — the identical defect shape one layer down.<br>3. A proactive audit (grep for every flow with its own STATUS handling: `assessmentSession`, `blueprintAuthoring`, `reflection`, `growthPlan` — confirmed no others exist) found that `reflectionFlow.js` and `growthPlanFlow.js` were internally safe (their STATUS/CANCEL branches are correctly gated behind their own active session state), but `commandHandler.js`'s guard from fix (1) only excluded `assessmentSessionState`/`blueprintAuthoringState`, not `reflectionState`/`growthPlanState` — meaning the same class of defect was latent for those two flows too, just not yet triggered live. Fixed proactively rather than waiting for a fourth live discovery.<br><br>**Fix implemented:** `core/commandHandler.js`'s STATUS/USAGE/BALANCE branch now checks all four flow session states (`assessmentSessionState`, `blueprintAuthoringState`, `reflectionState`, `growthPlanState`) and returns `false` (not handled) if any is active for the phone, mirroring the existing guard pattern already used for CANCEL-of-a-SAVE-prompt in the same file. `flows/assessmentSessionFlow.js`'s no-session STATUS/RESUME branch similarly checks `blueprintAuthoringState` before claiming ownership. `routes/webhook.js`'s `buildCommandDeps()` and `buildAssessmentSessionDeps()` updated additively to pass the newly-required state stores through.<br><br>**Files changed:** `core/commandHandler.js`, `flows/assessmentSessionFlow.js`, `routes/webhook.js`. No changes to `reflectionFlow.js`/`growthPlanFlow.js` themselves (already correct internally) or to any repository/service layer.<br><br>**Verification performed:** `tests/assessment-session-flow.test.js` (34/34) and `tests/blueprintAuthoringFlow.test.js` (41/41) pass clean after all three fix layers. `tests/growthPlanFlow.test.js`/`tests/reflectionFlow.test.js` each have one pre-existing, unrelated "correction path" failure caused by this sandbox's `better-sqlite3` native binary being a stub (`invalid ELF header`) — confirmed via `git stash` that the identical failure exists on `main` without this change. Live WhatsApp re-verification after each of the three fix layers: layer 1 fix alone was insufficient (surfaced layer 2 live); layer 2 fix confirmed STATUS mid-blueprint no longer returns the assessment-session message but had not yet been re-tested to confirm it returns the *correct* message; after layer 3 (proactive, not live-triggered), a final live pass confirmed `STATUS` mid-blueprint (sent after the Term prompt) correctly returns "Session status: *Status test 3* — waiting for the term (or SKIP)." STATUS mid-`reflection`/mid-`growthPlan` has not been live-tested (layer 3 was proactive, not a live discovery) — worth a spot-check but low risk, since the fix is structurally identical to the already-verified layer 1/2 fixes and both flows' internal STATUS handling was already confirmed correct by their own passing tests. Status: **Resolved.** |

---

| High | X.O | 2026-08-12 | 2026-08-12 | Resolved | **RC1-H-005** — A brand-new teacher's first natural greeting ("hi", "hello") never reached onboarding; they got the full command menu instead. Discovered live: sending "hi" to a fresh number returned the HELP/MENU reply and never started onboarding, while "hey" (a near-miss, not one of the aliased strings) correctly triggered onboarding — the inconsistency was the first clue.<br><br>**Root cause:** `core/messageProcessor.js` calls `deps.handleCommand()` unconditionally, before `deps.needsOnboarding()` is ever checked (line 106 vs line 109). `core/commandHandler.js`'s HELP/MENU/HI/HELLO branch exact-matched those four strings and returned `true` (handled) with zero awareness of onboarding state, for any user, brand-new or not — so it always intercepted first. `services/onboardingService.js` already contains the *intended* design for this, just unreachable: its own docstring says onboarding should run "BEFORE normal processing," and it has its own, narrower escape-hatch list (`['PRO', 'STATUS', 'HELP', 'PROFILE']` — note no MENU, no HI, no HELLO) that only applies mid-onboarding (`step !== null && step !== STEPS.DONE`) — a genuinely new user (`step === null`) gets no escape at all, by design. `commandHandler.js`'s wiring predates or ignores that design entirely.<br><br>**Scope, once traced:** not just HI/HELLO — HELP and MENU also bypassed onboarding for brand-new users (a defect against `onboardingService.js`'s own no-escape-for-new-users rule, just untested since "help"/"menu" are less natural first messages than "hi"). A proactive audit (mirroring RC1-H-004's layer-3 approach) found the identical gap in the PRO, STATUS/USAGE/BALANCE, and PROFILE branches — all three are in `onboardingService.js`'s own escape-hatch list and so are *supposed* to have no effect for a new user, but `commandHandler.js` intercepted them unconditionally too.<br><br>**Fix implemented:** `services/onboardingService.js` now exports `getOnboardingStep`/`setOnboardingStep` (previously internal-only). `routes/webhook.js`'s `buildCommandDeps()` and `__testExports` pass these through, plus `STEPS` (as `ONBOARDING_STEPS`). In `core/commandHandler.js`: the HELP/MENU/HI/HELLO branch now checks onboarding step before intercepting — `step === null` returns `false` (not handled) unconditionally; mid-onboarding, only HELP falls through to the menu (matching `onboardingService.js`'s own list) and now calls `setOnboardingStep(..., DONE)` on exit, mirroring what `handleOnboarding()`'s own escape hatch would have done had it been reached; MENU/HI/HELLO mid-onboarding return `false` so the flow's own step handler processes the reply instead. The PRO, STATUS/USAGE/BALANCE, and PROFILE branches each got the same minimal `step === null → return false` guard (mid-onboarding behavior for these three was already correct in effect, since they're in the intended escape list, and is left unchanged).<br><br>**Files changed:** `services/onboardingService.js`, `routes/webhook.js`, `core/commandHandler.js`, new `tests/onboarding-command-precedence.test.js`.<br><br>**Verification performed:** new `tests/onboarding-command-precedence.test.js` (36/36 assertions) against the real `routes/webhook.js` dispatch chain (not a flow-layer test double, per the RC1-H-004 lesson that flow-layer tests bypass real dispatch) — covering: brand-new teacher + all seven guarded aliases (HI/HELLO/MENU/HELP/PRO/STATUS/PROFILE, none intercepted), mid-onboarding + MENU/HI/HELLO (correctly not escaping) vs HELP (escapes, marks DONE), fully-onboarded (all four work normally), and "hey" retained as a regression anchor. No regressions: `cancel-pending-save.test.js` (13/13), `assessment-session-flow.test.js` (34/34), `blueprintAuthoringFlow.test.js` (41/41), `webhook-batch-processing.test.js` (5/5) all still pass clean.<br><br>**Not yet live-verified:** the fix has automated dispatch-chain test coverage but has not yet been re-tested live on WhatsApp (send "hi" from a genuinely fresh number and confirm onboarding starts) — worth a live pass before treating this as fully closed, consistent with this milestone's practice of live-verifying every High defect. Status: **Resolved** (pending live confirmation).<br><br>**Deployment note:** the fix (commit `02d8a44`) initially sat unpushed against local `main` while production remained on `09222b0` (RC1-H-003's close-out commit) — meaning RC1-H-004 (`f271ee7`/`07de62e` and its chain) was *also* undeployed at that point, not just this fix. First live re-test attempt against the stale deploy reproduced the original bug exactly (fresh number + "hi" → full command menu), which correctly identified a deployment gap rather than a code defect. `02d8a44` was pushed to `origin/main` and deployed; confirmed live via `git log -1 --oneline` on the running instance before re-testing.<br><br>**Live verification (2026-08-12):** onboarding row for the test number cleared (`DELETE FROM onboarding WHERE phone_hash = ...`, confirmed empty via follow-up `SELECT`), then "Hi" sent via WhatsApp against the deployed `02d8a44` build. Response: *"Hey! 👋 I'm your SA Teacher Assistant — I help you create CAPS-aligned worksheets, tests, lesson plans, and more, right here on WhatsApp. Quick question before we start: what's your name? (First name is fine)"* — the onboarding welcome/name prompt, not the command menu. Confirms the dispatch-order fix holds against the real production dispatch chain. Status: **Resolved.** |

---

| High | X.O | 2026-08-12 | 2026-08-12 | Resolved | **RC1-H-006** — Discovered live during Phase A Journey E (Workspace Management): a teacher who pasted a roster and replied `SAVE` to confirm it got "Nothing to save yet — generate a resource first (worksheet, test, lesson plan, etc.), then reply *SAVE* immediately after" instead of their roster being saved. The preview step itself was correct (`"5 learners parsed... Reply SAVE to confirm..."`), but confirming it silently discarded the pasted roster — no learners were ever persisted.<br><br>**Root cause:** identical collision shape to RC1-H-004 (STATUS/USAGE/BALANCE vs. flow-owned STATUS), one command lower. `core/messageProcessor.js` calls `deps.handleCommand()` unconditionally before the `alreadyMidFlow` dispatch that would route `SAVE` to `flows/rosterFlow.js`'s own PREVIEW-step handling. `core/commandHandler.js`'s global `SAVE` branch — which persists a just-generated resource via `deps.lastGeneratedState` — had zero awareness of `rosterState` and always intercepted `SAVE` first, regardless of an active roster session. The RC1-H-004 audit had scoped itself to "every flow with its own STATUS handling" and never considered that `SAVE` carries the same dual-meaning risk across flows; `rosterState` was consequently never added to `buildCommandDeps()` at all.<br><br>**Why existing tests missed it:** `tests/roster-flow.test.js` covers the PREVIEW → SAVE path and correctly asserts "Roster saved" — but calls `handleRosterFlow()` directly, bypassing `routes/webhook.js` → `core/messageProcessor.js` → `core/commandHandler.js` entirely. This is the same test-architecture blind spot RC1-H-004 documented: flow-level tests pass because they never see the global command handler intercept the message first.<br><br>**Fix implemented (deliberately narrow-scoped):** `core/commandHandler.js`'s `SAVE` branch now returns `false` (not handled) when `deps.rosterState` has an active session for the phone (any step, not just PREVIEW — mirroring the STATUS guard's breadth), letting `messageProcessor.js`'s `alreadyMidFlow` dispatch route `SAVE` to `flows/rosterFlow.js`'s own handler instead. `routes/webhook.js`'s `buildCommandDeps()` now passes `rosterState` through additively. Blast radius: only the `SAVE` + active-roster-session combination is affected — generated-resource `SAVE` behavior is completely unchanged whenever no roster session is active (the overwhelming majority of `SAVE` messages). No weakening or deletion of the global `SAVE` handler; both features retain their own SAVE meaning within their own context.<br><br>**Files changed:** `core/commandHandler.js` (+16 lines), `routes/webhook.js` (+13 lines, additive: `rosterState` added to `buildCommandDeps()`; `rosterState`/`processMessage`/`buildProcessMessageDeps` added to `__testExports`), new `tests/rc1-h-006-save-roster-collision.test.js`.<br><br>**Verification performed:** new `tests/rc1-h-006-save-roster-collision.test.js` (22/22 assertions) against the real dispatch chain via `processMessage()` (not `handleRosterFlow()` directly, per the lesson above) — covering: roster PREVIEW + SAVE (roster actually saved, DB row count confirmed), roster PREVIEW + EDIT (unaffected), roster PREVIEW + CANCEL (unaffected), generated-resource state + SAVE with no roster session (still saves the resource correctly, DB row count confirmed), no pending resource and no roster session + SAVE (original "nothing to save" response unchanged), and roster session active at a non-PREVIEW step + SAVE (falls through correctly, no spurious resource save). No regressions: `tests/roster-flow.test.js` (84/84), `tests/cancel-pending-save.test.js` (13/13), `tests/routing-order-workspace-flow.test.js` (39/39), `tests/blueprintAuthoringFlow.test.js` (41/41) all pass clean. (`tests/menu-help-session-reset.test.js` fails identically on unmodified `main` at the pre-fix commit — confirmed via `git stash` — and is therefore a pre-existing, unrelated sandbox issue, not attributable to this change.)<br><br>**Deployment:** commit `6860ee2` pushed to `origin/main` and auto-deployed to Render; confirmed live via `/healthz` (200, service healthy) before live re-testing.<br><br>**Live verification (2026-08-12):** exact defect reproduction performed against the deployed `6860ee2` build, live on WhatsApp, with no resource generated beforehand — `ROSTER` → class selection ("RC1 Verification Class") → pasted 5 learner names → preview confirmed correctly → `SAVE`. Response: *"Roster saved for RC1 Verification Class. 5 added, 0 matched."* followed by the full numbered list of all 5 learners. No trace of the old "Nothing to save yet" interception. Confirms the fix holds against the real production dispatch chain, not just the regression suite. Status: **Resolved.** |
| High | X.O | 2026-08-13 | 2026-08-13 | Resolved | **RC1-H-007** — Discovered live during RC1 Journey D (Assessment PRINT/menu verification): at `flows/assessmentSessionFlow.js`'s `COMPLETE_MENU` (offered immediately after marks capture completes — "1. Start a new assessment / 2. Print a blueprint question paper"), replying with the digit `2` repeatedly failed to dispatch to PRINT, instead falling through to a re-rendered menu, reproduced three times live in production. Literal text (`NEW TEST`, `PRINT`) worked reliably as a workaround, which was the first clue this was a numeric-reply-specific defect rather than a broken PRINT sub-flow.<br><br>**Diagnostic instrumentation:** temporary logging added to `flows/assessmentSessionFlow.js` (commit `d3c1644`, additive only, no behavior change) surfaced `NavigationService.consumeNumericReply()`'s internal `reason` field whenever a `COMPLETE_MENU` numeric reply failed to match. Live production logs showed, for all three reproductions: `reason=no_menu_open rawReply="2"` — ruling out `not_numeric` and `unknown_option`; the menu itself could not be found at consumption time, despite `openMenu()` having just run moments earlier at capture completion.<br><br>**Root cause:** `core/messageProcessor.js` called `NavigationService.evaluateMessage()` once per message as a supposedly discarded, side-effect-free "dry run" (ADR-019 Step 3, Commit 2 — the inline comment at that call site explicitly claimed "no new output, no new side effects"). This was incorrect: `evaluateMessage()` internally calls `consumeNumericReply()` (`services/navigationService.js` §4), which is destructive on match — a matching numeric reply closes the open menu so a replayed digit can't double-fire. Sequence for a reply of `2` at `COMPLETE_MENU`: (1) `messageProcessor.js` calls the "discarded" `evaluateMessage('2')`; (2) internally matches PRINT and closes the menu, result thrown away; (3) dispatch reaches `assessmentSessionFlow.js`'s real `COMPLETE_MENU` handler, which calls `consumeNumericReply('2')` again; (4) the menu is already gone, so `reason: no_menu_open`, and the handler falls through to its generic invalid-reply re-render. Two different layers of the same request believed they were entitled to consume the same reply.<br><br>**Fix implemented (deliberately narrow-scoped):** `core/messageProcessor.js` now skips the speculative `evaluateMessage()` call whenever `activeFlowId` is already set (i.e. `assessmentSessionState` or `blueprintAuthoringState` has an active session for the phone), so the owning flow's own handler is the sole consumer of the reply. When no flow is active, `evaluateMessage()` still runs exactly as before — top-level/standalone numeric-menu behavior is unchanged, confirmed by an explicit regression assertion (see below). No changes to `consumeNumericReply()` itself or any other part of `NavigationService` — a "peek"/non-destructive variant was considered and deliberately rejected as unnecessary scope expansion during RC1.<br><br>**Files changed:** `core/messageProcessor.js` (+14 lines, single `if (!activeFlowId)` guard around the existing call), new `tests/rc1-h007-complete-menu-double-consumption.test.js`.<br><br>**Verification performed:** new `tests/rc1-h007-complete-menu-double-consumption.test.js` exercises the real `processMessage()` router end-to-end (not `handleAssessmentSessionFlow()` directly — a flow-layer test would not have caught this, since the bug lived in the router, per the same lesson RC1-H-004/H-006 established) — covering: `"2"` at `COMPLETE_MENU` reaching PRINT (state advances to `SELECT_PRINT_BLUEPRINT`, the print blueprint list is prompted, the completion menu is not re-rendered, the menu is closed exactly once), `"1"` at `COMPLETE_MENU` reaching `NEW_ASSESSMENT` (state advances to `SELECT_BLUEPRINT`), and an explicit guard-scope check that with no active flow, `evaluateMessage()` still consumes/closes a standalone open menu exactly as before the fix. Causality confirmed by reverting the fix and re-running: 6/9 assertions failed, reproducing the exact live failure (`reason=no_menu_open` for both digits); restoring the fix returned 9/9 passing. No regressions: `tests/assessment-completion-menu.test.js` (27/27), `tests/assessment-session-bulk-dispatch.test.js` (23/23), `tests/assessment-session-flow.test.js` (34/34), `tests/assessment-session-print.test.js` (27/27), `tests/assessment-session-undo-dispatch.test.js` (22/22), `tests/blueprintAuthoringFlow.test.js` (41/41), `tests/routing-order-observation-priority.test.js` (9/9), `tests/routing-order-workspace-flow.test.js` (39/39) all pass clean. (`tests/navigation-service.test.js` — sandbox-only native `better-sqlite3` load failure, "invalid ELF header" — and `tests/routing-order-assessment-session-priority.test.js` — 13/14, one pre-existing unrelated assertion — and `tests/menu-help-session-reset.test.js` — pre-existing uncaught error — each confirmed byte-identical with the fix applied vs. reverted via `git stash`, and are therefore pre-existing, unrelated issues, not attributable to this change.)<br><br>**Deployment:** commit `cfcdc7a` pushed to `origin/main` and auto-deployed to Render (deploy window 07:02:04–07:02:46 UTC); confirmed no subsequent deploy occurred through 07:14:48 UTC, meaning the same live instance served both live verification tests below.<br><br>**Live verification (2026-08-13, ~09:03–09:14 SAST):** exact defect reproduction performed against the deployed `cfcdc7a` build, live on WhatsApp, twice from scratch. Run 1 — `NEW TEST` → blueprint → class (Grade 6A Mathematics, 10 learners) → marks captured for all 10 → `COMPLETE_MENU` → `2`. Response: dispatched directly to "Print a Question Paper → Choose a Blueprint," no repeated completion menu; the resulting blueprint selection was carried through to a real, correctly-formatted printable question paper PDF. Run 2 — same setup, `COMPLETE_MENU` → `1`. Response: dispatched directly to "New Assessment Session → Choose a Blueprint," no repeated completion menu. Render logs for the full verification window (07:03:41–07:14:48 UTC, spanning both runs): zero occurrences of `COMPLETE_MENU numeric reply not matched`, versus three occurrences of exactly that line during the original 06:40 UTC reproduction on the pre-fix build. Confirms the fix holds against the real production dispatch chain for both `COMPLETE_MENU` options, not just the regression suite. Status: **Resolved.** |
| High | X.O | 2026-08-13 | 2026-08-13 | Resolved | **RC1-D1-001** — Discovered live during Journey D1 (Assessment Creation) production verification: every blueprint in the `NEW TEST` / `PRINT` blueprint-selection list on WhatsApp displayed as `— undefined questions` instead of the real count, e.g. `1. Fractions Test Term 2 (Grade 6, Mathematics) — undefined questions`. Cosmetic-only — capture and completion continued to function — but confirmed as a genuine, currently-live production defect rather than expected behavior.<br><br>**Root cause:** `flows/assessmentSessionFlow.js`'s `formatBlueprintList()` read `b.question_count` (snake_case) off each blueprint object. `services/blueprintRepository.js`'s `listBlueprints()` — the actual, documented source of this data (see its JSDoc `@returns`) — returns each blueprint with a camelCase `questionCount` field instead. The snake_case key does not exist on the returned object, so it evaluated to `undefined` and rendered verbatim into the WhatsApp message. Confirmed via grep that `formatBlueprintList()` was the only consumer of `question_count` across `flows/`, `services/`, `core/`, `routes/`, `utils/`, `dashboard/src` — no other file needed changing.<br><br>**Fix implemented (deliberately narrow-scoped):** `flows/assessmentSessionFlow.js`, `formatBlueprintList()` — `b.question_count` → `b.questionCount`, both occurrences, one line. `services/blueprintRepository.js` was **not** touched; its camelCase contract is the source of truth and remains unchanged.<br><br>**Files changed:** `flows/assessmentSessionFlow.js` (2-word change on one line), new `tests/rc1-d1-001-blueprint-question-count-display.test.js`.<br><br>**Verification performed:** new `tests/rc1-d1-001-blueprint-question-count-display.test.js`, built against the real `listBlueprints()` contract shape (camelCase `questionCount`, not a fixture mirroring the bug), covering both `NEW TEST` and `PRINT` blueprint lists, and singular/plural/zero-question cases (`1 question`, not `1 questions`; `0 questions`, not `undefined questions`). Causality confirmed by reverting the fix and re-running: 0/6 assertions passed, reproducing the exact live `undefined questions` symptom on every case; restoring the fix returned 6/6 passing. Full existing D-journey baseline (13 suites, including `RC1-H-007`'s own regression test) re-run clean against this fix with zero new failures and zero regressions — identical results to the pre-fix baseline, including the same pre-existing stale routing assertion already attributed to the intentional RC1-H-004 guard (unrelated). `authCodeRepository.test.js`'s one pre-existing failure (`B: expires_at is in the future`) confirmed via `git stash` to fail identically on unmodified `main` at the pre-fix commit — pre-existing and unrelated, not attributable to this change.<br><br>**Known follow-up (not fixed here, out of scope for this defect):** `tests/assessment-session-flow.test.js`'s `blueprintsFixture` uses `question_count` (snake_case) rather than the real `questionCount` contract — an accidental mirror of this exact bug, and the reason the existing suite never caught it. Left untouched pending a separate test-fixture correction pass.<br><br>**Deployment:** commit `b6c22d2` pushed to `origin/main` and auto-deployed to Render; confirmed live via the Render dashboard (`Deploy live for b6c22d2`, green checkmark, service header showing `b6c22d2` / `Live`).<br><br>**Live verification (2026-08-13):** exact defect reproduction re-checked against the deployed `b6c22d2` build, live on WhatsApp — a mid-session `NEW TEST` at 10:30 showed real question counts for all five blueprints (`Empty Test — 1 question`, `CAPS Test — 2 questions`, `Fractions Test Term 2 — 2 questions`, `Fractions Test Term 2 — 1 question`, `Fractions Test (Seed) — 4 questions`), correct singular/plural throughout, no `undefined` anywhere. A follow-up clean smoke test (`CANCEL` then a fresh `NEW TEST`, 10:33) reproduced the identical correct counts from a genuinely zero-state session, giving an unambiguous fresh-session verification artifact. Confirms the fix holds against the real production dispatch chain, not just the regression suite. Status: **Resolved.**<br><br>**Deferred, not part of this defect:** the blueprint list surfaced two apparently-duplicate `Fractions Test Term 2 (Grade 6, Mathematics)` entries and an `Empty Test` entry of unclear intent (draft vs. seed data vs. accidental duplicate). Flagged for a separate data-investigation item; not modified as part of closing RC1-D1-001. |

## RC2 Backlog

Anything raised during RC1 that isn't a blocking defect goes here instead of
being implemented. Starts empty.

Known candidates already deferred out of RC1 scope:
- Localisation (Afrikaans/other language UI beyond existing prompt-language injection)
- Dashboard improvements (PR29–32 analytics/QMS workspace/reporting/home analytics)
- Analytics enhancements
- Advanced coaching (per-channel/per-locale message variants — ADR-018 left this seam open on purpose)
- AI capability improvements

| Date | Raised by | Idea | Notes |
|---|---|---|---|
| | | | |

---

## Known Open Issues

Different from the RC2 Backlog above. The backlog is deferred *ideas* and
enhancements. This is defects you are knowingly shipping RC1 with — Low
severity, workaround exists, decision to ship anyway made deliberately
rather than by omission. Starts empty; a Critical or High defect must
never appear here (see Defect Classification).

| ID | Severity | Workaround | Planned Version |
|---|---|---|---|
| | | | |

---

## Defect Classification

| Severity | Definition | RC1 Rule |
|---|---|---|
| Critical | Data loss, security exposure, payment double-charge/no-charge, bot-wide crash | Must fix before pilot |
| Medium | X.O | 2026-08-04 | 2026-08-04 | Resolved | **RC1-M-001** — Bulk-paste marks capture: when every learner in a pasted block was rejected by `adaptParsedMarks()` (e.g. a per-question mark exceeding the blueprint's actual max), the teacher only saw the generic error "No learners could be captured from that paste. Please check the format and try again." — the specific, already-computed per-learner reasons (`result.skipped`, e.g. `"Skipped \"Thabo\" — Q3 must be between 0 and 5 (got 6)."`) were silently discarded in `flows/assessmentSessionFlow.js`'s `!result.ok` branch, which only sent `result.error`. Reproduced live in WhatsApp (paste with Q3/Q4 marks scaled to a 10-mark assumption against a blueprint where all 4 questions are actually max 5) and confirmed via direct unit-level reproduction of `submitBulkReply()`/`adaptParsedMarks()`. **Fix:** added `formatBulkFailureDetail()` to `flows/assessmentSessionFlow.js`, appending the skip reasons to the generic error whenever a bulk paste is fully rejected. Verified: `assessment-bulk-capture.test.js` (37/37), `assessment-session-flow.test.js` (34/34), and 7 other touched suites (295 assertions total) all pass with no regressions. |
| Medium | X.O | 2026-08-04 | 2026-08-04 | Resolved | **RC1-M-002** — Multiple teacher-facing WhatsApp messages rendered literal `\n`/`\n\n` text (e.g. "Which class?\n\n1. Grade 6A...") instead of real line breaks, across the class-selection prompt, "no classes yet" message, Class Intervention summary, Class/Learner Progress PDF-ready captions, and the printable question paper caption. Root cause: 23 template literals across `flows/workspaceFlow.js` (22) and `flows/assessmentSessionFlow.js` (1) used a double-escaped `\\n` instead of `\n`. **Fix:** normalized all 23 occurrences to real newline escapes; left the unrelated legitimate LaTeX command mappings (`\le`, `\geq`, etc.) in `services/pdfService.js` untouched. Verified: repo-wide byte-level sweep confirms zero remaining instances outside the LaTeX map; 7 touched test suites (207 assertions) pass with no regressions; confirmed clean rendering on two subsequent live WhatsApp runs. |
| Low | X.O | 2026-08-04 | | | **RC1-L-001** — The `NEW TEST` blueprint-selection prompt displays "— undefined questions" instead of an actual question count (e.g. "Fractions Test (Seed) (Grade 6, Mathematics) — undefined questions"). Cosmetic only — does not block the underlying flow, which completes correctly once a blueprint is selected. Not yet root-caused or fixed. |
| High | A core flow (coaching, assessment capture, generation, payment) fails or gives wrong output | Must fix before pilot |
| Medium | Secondary flow misbehaves, or a rough edge with no data/money loss | Fix if low risk, else defer with a written reason |
| Low | Cosmetic, wording, rare edge case with an easy workaround | May defer to RC2 Backlog |
| Enhancement | Not a defect — a new capability someone asked for | Goes to RC2 Backlog, never implemented during RC1 |

---

## Accepted Limitations

Product scope decisions going into RC1 — not defects, and not things that
could fail. Listed here so nobody discovers them mid-pilot and mistakes a
deliberate scope choice for a bug.

- English-only coaching messages (localisation deferred to RC2, per ADR-018's message-renderer seam)
- No dashboard yet (PR29–32 analytics/QMS workspace/reporting/home analytics — RC2)
- No mobile app (WhatsApp-only for RC1)
- Localisation deferred to RC2

---

## RC1 Success Criteria

Distinct from pilot success metrics (Phase C) — this is what makes RC1
itself, as a release, successful:

RC1 is considered successful when:
- Pilot completes without a triggered rollback
- No Critical defects remain open
- No High defects remain open
- Pilot teachers indicate they would continue using the system
- v1.0.0 is approved at the RC1 Approval Meeting

---

## Release Artifacts

Complete before the Approval Meeting — a precise record of exactly what
was deployed, so it can be reconstructed months later without guessing.

- [ ] Git tag created (`v1.0.0-rc1`)
- [ ] Release notes written
- [ ] Commit hash recorded: ___________________
- [ ] Production configuration archived (env vars list, not secrets themselves)
- [ ] Deployment timestamp: ___________________
- [ ] Pilot start date: ___________________
- [ ] Pilot end date: ___________________

---

## RC1 Approval Meeting

Held before deploying to production / starting the pilot. One deliberate
decision, not a gradual drift into launch.

**Required attendees:**
- Product owner
- Developer

*(For a solo project, this still means physically stopping and answering
these in writing before proceeding — not skipping the gate because there's
only one person in the room.)*

**Questions:**
- [ ] Phase A complete?
- [ ] Phase B complete?
- [ ] Any open Critical defects?
- [ ] Any open High defects?
- [ ] Rollback plan verified (not just written — actually tested)?
- [ ] Pilot teachers confirmed?

**Decision:**
- [ ] Approved
- [ ] Delayed — reason: ___________________

### Go / No-Go Rules

If every Release Criterion below is satisfied:
→ Approve RC1 → Deploy → Begin Pilot (Phase C)

If any Critical or High defect remains open:
→ RC1 is rejected → fixes are implemented → a new candidate is cut as
`v1.0.0-rc2` → Phase A is repeated in full, and any Phase B item touched
by the fix is repeated → a fresh Approval Meeting is held before the
pilot begins.

There is no partial approval. A "Delayed" decision above always resolves
to one of these two paths, never to proceeding with an open Critical/High
defect on the strength of a judgment call.

### After a No-Go: does Phase C restart?

Yes, always, for an RC2 cut. RC2 is a new candidate, so it gets a full
Pilot run — pilot feedback on RC1 doesn't carry over to validate RC2's
fix, since the fix itself is what's unverified.

```
RC1
 ↓
Go/No-Go
 ├─ Go  → Deploy → Pilot (Phase C) → RC1.1 → v1.0.0
 └─ No-Go → fix → v1.0.0-rc2
              ↓
         Phase A (repeat, full)
              ↓
         Phase B (repeat affected items)
              ↓
         Approval Meeting (fresh)
              ↓
         Pilot (Phase C, full 14 days)
```

---

## Release Criteria

RC1 may be released only when:

- [ ] Phase A passed
- [ ] Phase B passed
- [ ] Deployment Verification passed
- [ ] Phase C completed successfully
- [ ] No Critical or High defects remain open
- [ ] Required release documentation complete
- [ ] Deployment reproducible
- [ ] Feature freeze maintained throughout

```
RC1 Status
  Functional Verification      ☐ PASS
  Production Readiness         ☐ PASS
  Pilot Complete                ☐ PASS

Decision
  ☐ RC1 Approved
  ☐ RC1 Blocked — reason: ___________________
```

---

## Where the project stands (estimate, as of this document)

- Core architecture: ~100%
- Core implementation: ~95%
- Automated test coverage: ~95%
- Release readiness: unknown until Phase A and Phase B complete — that's what those phases are for
- Real-world validation: ~0–10% — **this is the gap this document exists to close**

---

## After RC1

```
RC1
 ↓
Pilot (14 days)
 ↓
RC1.1 (bug fixes only, from pilot findings)
 ↓
Production Release v1.0
 ↓
RC2 (new capabilities resume — RC2 Backlog above becomes the input)
```

Every task from here forward should either check off an RC1 item, fix a
verified RC1 defect, or get deferred to the RC2 Backlog. Nothing else.
