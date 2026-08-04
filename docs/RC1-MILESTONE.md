# RC1 Milestone — Release Candidate 1

**Document Version:** 1.0
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
| Item | Automated ref | Pass | Fail | Notes |
|---|---|---|---|---|
| WhatsApp OTP login (request-code → verify-code) | `pr22-whatsapp-otp.test.js` | ☐ | ☐ | |
| Dev OTP bypass correctly disabled in production | `pr25-dev-otp-bypass.test.js` | ☐ | ☐ | |
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
| NEW TEST (session start → blueprint → class) | `assessment-session-flow.test.js` | ☐ | ☐ | |
| Interactive mark capture | `assessment-capture-service.test.js` | ☐ | ☐ | |
| Bulk paste mark capture | `assessment-bulk-capture.test.js` | ☐ | ☐ | |
| UNDO / EDIT mid-capture | `assessment-capture-undo.test.js`, `assessmentCaptureService.edit.test.js` | ☐ | ☐ | |
| Upload marks (CSV/text) | `test-marks-parser.js`, `parsed-marks-adapter.test.js` | ☐ | ☐ | |
| Item analysis / blueprint analytics | `blueprint-analytics.test.js` | ☐ | ☐ | |
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

## Defect Classification

| Severity | Definition | RC1 Rule |
|---|---|---|
| Critical | Data loss, security exposure, payment double-charge/no-charge, bot-wide crash | Must fix before pilot |
| High | A core flow (coaching, assessment capture, generation, payment) fails or gives wrong output | Must fix before pilot |
| Medium | Secondary flow misbehaves, or a rough edge with no data/money loss | Fix if low risk, else defer with a written reason |
| Low | Cosmetic, wording, rare edge case with an easy workaround | May defer to RC2 Backlog |
| Enhancement | Not a defect — a new capability someone asked for | Goes to RC2 Backlog, never implemented during RC1 |

---

## Known Risks

Accepted limitations going into RC1 — not defects, just things the pilot
is not attempting to solve. Listed here so nobody discovers them mid-pilot
and mistakes them for bugs.

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

---

## Release Criteria

RC1 may be released only when:

- [ ] All Phase A items pass
- [ ] All critical bugs resolved
- [ ] No open data-loss bugs
- [ ] No security blockers
- [ ] Pilot completed successfully (14 days, success metrics met)
- [ ] Documentation complete
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
