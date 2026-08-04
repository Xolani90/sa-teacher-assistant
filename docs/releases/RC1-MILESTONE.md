# RC1 Milestone — Release Candidate 1

**Document Version:** 1.4
**Last Updated:** 2026-08-04
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
| NEW TEST (session start → blueprint → class) | `assessment-session-flow.test.js` | ☐ | ☑ | FAIL — RC1-H-001: no production entry point exists to create/publish Assessment Blueprints. Workaround (manually seeded blueprint via fixed `scripts/seedTestBlueprint.js`) confirmed the flow itself completes end-to-end once a blueprint exists: `NEW TEST` found "Fractions Test (Seed)" and captured marks for 5/5 learners successfully in WhatsApp. Remaining Assessment rows tested under this same workaround. |
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
| High | X.O | 2026-08-04 | | | **RC1-H-001** — No teacher-accessible production path exists to create and publish Assessment Blueprints. `createBlueprint()`/`publishBlueprint()` (`services/blueprintRepository.js`) have no caller outside `scripts/seedTestBlueprint.js` (a dev seeding script) and the test suite. Verified no path via: AI intent classifier (no blueprint-creation intent type), fixed WhatsApp commands (`NEW TEST`, `PRINT` both require an existing published blueprint), `routes/api.js` (zero blueprint references; its only POST/PATCH/DELETE routes are `/reflections`, unrelated), `routes/webhook.js` (only imports read-only `listBlueprints`/`getBlueprintById`), `flows/assessmentSessionFlow.js` (only reads via `listBlueprints`), `core/` (no blueprint references), and no cron/scheduler exists. Impact: `NEW TEST` and everything downstream (PRINT, interactive/bulk mark capture, UNDO/EDIT, item analysis, CLASS INTERVENTION, LEARNER PROGRESS) is unreachable for a pilot teacher on RC1 as shipped. The blueprint subsystem itself (validation, versioning, marks import, analytics, PDF export) is fully implemented and tested — only the production entry point to create/publish is missing. |
| High | X.O | 2026-08-04 | 2026-08-04 | Resolved | **RC1-H-002** — Assessment intervention analytics produce incorrect results. Tested under the RC1-H-001 workaround (manually seeded blueprint "Fractions Test (Seed)", Grade 6 Mathematics, 5 learners, marks captured via `NEW TEST` in WhatsApp): the generated Intervention Report shows "Common Fractions" and "Whole Numbers" both at 140% of learners affected — impossible with 5 learners (max is 100%) — and separately states "Target group size: 0 learners," while the accompanying Blueprint Assessment Report PDF correctly identifies 2 learners below the 40% support threshold (Samuel Tshabalala 20%, Motlatsi Moloi 0%). Impact: a teacher could be shown a report that simultaneously flags a topic-wide problem and recommends acting on zero learners, producing incorrect instructional guidance.<br><br>**Root cause analysis (2026-08-04):**<br>1. `services/errorAnalysisService.js` (line 155) counts question failures rather than unique affected learners when aggregating by topic: `topicErrors[topic].frequency` accumulates a per-question failure tally and sums across every question sharing a topic, so a learner failing multiple questions under one topic is counted more than once. With 2 questions per topic in the seeded blueprint, this allows "learners affected" percentages to exceed 100%.<br>2. `services/interventionReportsService.js` (lines 158, 229) reads `report.interventionPlan.targetGroups` (plural, expecting an array), but `services/interventionPlanService.js` (line 76) returns the field as `targetGroup` (singular, a pre-formatted string). The property name mismatch means `targetGroups` is always `undefined`, silently falling back to an empty array via `|| []`, producing a target group size of 0 even though correct group/count data (Group C: 2, Group D: 2) exists under the correctly-named field.<br><br>**Fix implemented (2026-08-04):**<br>1. `errorAnalysisService.js`'s `performErrorAnalysis()` now tracks a `Set` of unique affected learner names per topic (parsing each learner's `question_data` the same way `itemAnalysisService.js` does, using the same half-marks-per-question threshold), rather than summing per-question failure counts. `frequency` is now that Set's size, so it can never exceed the class size.<br>2. `interventionPlanService.js`'s `generateInterventionPlan()` now returns `targetGroups` (the array) alongside the existing `targetGroup` (the display string), so `interventionReportsService.js`'s existing read of `targetGroups` resolves correctly instead of silently defaulting to an empty array.<br><br>**Verification performed:** standalone reproduction of the exact seeded scenario (5 learners, 2 questions per topic, matching the captured marks and Group A–D distribution from the WhatsApp session) confirmed the old formula reproduces 140%/0-learners exactly as observed in production, and the fixed formula produces 80% (≤100%, unique-learner-based) and 4 learners (Group C + Group D, correctly read). **Final verification (2026-08-04):** (1) Automated tests run directly via `node` (working around a sandboxed `npm install` block on an unrelated `xlsx`/`better-sqlite3` dependency): `tests/intervention-reports.test.js` 11/11 passed, `tests/blueprint-analytics.test.js` 21/21 passed, no regressions in any other suite that could execute without the missing native module. (2) Fresh live WhatsApp run against a newly seeded "Fractions Test (Seed)" assessment (5 learners, marks captured via `NEW TEST`, different data from the original bug report): the generated Intervention Report shows "Common Fractions — 60% of learners affected" (3 of 5 learners — correctly ≤100%, no repeat of the 140% bug) and "Target group size: 3 learners" (Group C: 2 + Group D: 1, correctly read — no repeat of the 0-learners bug). Status: **Resolved.** |

---

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
