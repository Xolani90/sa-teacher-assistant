# RC1 Pilot Pack

## 1. Pilot Purpose

RC1 is validating one thing: whether SA Teacher Assistant works reliably for real teachers, doing real work, over 14 consecutive days — not whether the code is well-written or the architecture is sound. Those questions have already been answered by prior audits (see Section 2). What remains unproven is behavior under actual usage: real WhatsApp messages, real timing, real AI provider conditions, real teacher patience, and real data accumulating over time.

This pilot exists to collect that evidence, not to re-litigate anything already closed.

## 2. Current Baseline

**Already proven (code/audit evidence — not pilot evidence):**

- Production commit: `582eca2` (deployed live on Render as of the most recent verification; treat the Render Events/Deploys tab as the source of truth for exact deploy timing, since log output alone cannot print a commit SHA)
- Gemini model: `gemini-3.6-flash`, confirmed by a successful production Gemini generation after the last deploy
- Provider cascade Anthropic → OpenAI → Gemini is implemented and wired in code
- All three production environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) are present in the Render dashboard
- Security/access-control, dashboard/navigation, WhatsApp/dashboard parity, PDF/fraction rendering, dependency audit, and RC2 defect review are all CLOSED with no unresolved findings
- Sentry error monitoring and global `uncaughtException`/`unhandledRejection` handlers are present
- WhatsApp webhook route exists, is rate-limited, and enforces `X-Hub-Signature-256` verification

**Current known operational condition (as of the last log review):**

Anthropic and OpenAI currently have no usable credits/quota in production (`credit_exhausted` and rate-limit/no-credits errors respectively). Gemini is operational and has served requests successfully end-to-end, including delivering a PDF. **This is a billing/quota condition, not a software defect** — the cascade code itself is correct and was proven to reach Gemini and succeed. Practically, this means the pilot is currently running on a Gemini-only path with no live redundancy; if Gemini has an outage during the pilot, there is no functioning fallback until Anthropic or OpenAI credits are restored.

**How this is tracked during the pilot:**

- A command that fails on Anthropic and/or OpenAI but succeeds on Gemini counts as a **successful command** for completion-rate purposes.
- Which provider actually served each request is tracked **separately**, as an operational/fallback metric — not as a pass/fail signal on its own.
- A command only counts as a **failure** if every configured provider (currently, in practice, just Gemini) fails and the teacher receives an apology/rollback message.

## 3. Pilot Scope

- **Size:** 5–10 teachers
- **Duration:** 14 days

**In-scope journeys:**

1. Authentication
2. Teaching
3. Assessment
4. Coaching/QMS
5. Workspace
6. Observations/Portfolio
7. WhatsApp delivery

**Out of scope:** Payments/Yoco. No Yoco journey should be tested, reported on, or counted against pilot success criteria.

## 4. Pilot Objectives

| Area | Objective |
|---|---|
| Reliability | The system behaves consistently across repeated real-world use, with no repeating unexplained errors |
| Completion | Teachers can complete the commands they attempt, across all 7 in-scope journeys |
| Response time | Teacher-visible response time stays within an acceptable, teacher-usable range |
| Data integrity | No data corruption, duplication, or cross-teacher leakage occurs over sustained real use |
| Stability | No crashes or unhandled failures occur outside of expected, recovered provider fallback |
| Teacher independence | Teachers can complete their work without developer intervention beyond normal onboarding |
| AI fallback behaviour | The provider cascade behaves as designed under real (currently degraded) provider conditions, and fallback usage is understood, not just tolerated |

## 5. Success Criteria

- **Command completion:** ≥95%
- **Average response time:** <10 seconds where applicable
- **Data corruption:** 0
- **Duplicated resources:** 0
- **Unexplained crashes:** 0
- **Teacher assistance:** tracked (no fixed target — logged and reviewed)
- **AI total failures:** tracked (no fixed target — logged and reviewed)

**What counts as an attempted command:** Any distinct teacher-initiated command dispatched into the system — identifiable in logs via `[WEBHOOK] Processing message ${messageId} from ...NNNN`. A message that the system itself recognizes and discards as a duplicate (`[WEBHOOK] Duplicate message ignored`) is **not** a new attempt.

**What counts as a completed command:** A corresponding successful outcome for that attempt — a `[WEBHOOK] Response delivered to ...NNNN` (or the equivalent flow-specific success log/PDF-sent log) reaching the teacher, with no rollback or failure message sent in its place.

- A command that fails on one or more providers but ultimately succeeds via fallback (including reaching Gemini after Anthropic and OpenAI fail) **is a completed command**.
- A command that fails across **all** available providers, or times out, or triggers a rollback/apology message, **is an unsuccessful command** — it counts against the denominator but not the numerator of the completion rate.

## 6. Teacher Onboarding Checklist

For each pilot teacher, before they start real usage, confirm:

- [ ] Teacher has been added/granted access (phone number registered in the system)
- [ ] Teacher can authenticate successfully (receives and can use their access/login flow)
- [ ] Teacher has sent and received at least one WhatsApp message to/from the assistant
- [ ] Teacher can access the dashboard (if their role uses it) and see their own data
- [ ] Teacher has completed one basic first task end-to-end (e.g., a simple worksheet request) and received a response
- [ ] Teacher knows exactly how to report a problem (who to message, what to include — e.g., what they asked, what happened, roughly when)
- [ ] Teacher has confirmed, in their own words, that they can proceed with their normal work without needing a developer standing by

Teachers do not need to know anything about providers, fallback, databases, or deployment. If an onboarding step requires explaining internal architecture to get a teacher unstuck, that itself is worth noting under Teacher Assistance (Section 13) as a possible usability gap.

## 7. Required Pilot Journeys

### 1. Authentication
- **Teacher does:** Logs in / verifies identity through the normal flow.
- **Success looks like:** Teacher gains access without confusion or repeated attempts.
- **Evidence to record:** Date, teacher, success/failure, any retry needed.
- **Report as incident if:** Teacher is locked out, gets an unclear error, or needs developer help to get in.

### 2. Teaching
- **Teacher does:** Requests a lesson plan, worksheet, test, or similar content via WhatsApp.
- **Success looks like:** Teacher receives usable content (and PDF, where applicable) in reasonable time.
- **Evidence to record:** Command type, response time, fallback used, PDF delivered y/n.
- **Report as incident if:** No response, malformed content, wrong grade/subject, or excessive delay.

### 3. Assessment
- **Teacher does:** Requests marking, rubric, analysis, or similar assessment support.
- **Success looks like:** Correct, usable output tied to the right learners/marks.
- **Evidence to record:** Command type, response time, any data mismatch.
- **Report as incident if:** Marks/results appear wrong, missing, or attributed to the wrong learner.

### 4. Coaching/QMS
- **Teacher does:** Uses coaching messages, intervention plans, or quality-management features.
- **Success looks like:** Teacher receives relevant, correctly-targeted guidance.
- **Evidence to record:** Command type, response time, relevance/usefulness note.
- **Report as incident if:** Content is generic, wrong, or fails to generate.

### 5. Workspace
- **Teacher does:** Reads/manages their own saved resources, classes, or settings.
- **Success looks like:** Teacher sees their own data, correctly, promptly.
- **Evidence to record:** Action taken, success/failure.
- **Report as incident if:** Teacher sees missing, duplicated, or someone else's data.

### 6. Observations/Portfolio
- **Teacher does:** Logs or reviews observations/portfolio entries.
- **Success looks like:** Entries save and display correctly and persist across sessions.
- **Evidence to record:** Action taken, success/failure, persistence check on a later day.
- **Report as incident if:** Entries vanish, duplicate, or fail to save.

### 7. WhatsApp
- **Teacher does:** All of the above happen through WhatsApp as the delivery channel.
- **Success looks like:** Messages send and receive reliably, PDFs arrive when expected.
- **Evidence to record:** Delivery success/failure, delay if any.
- **Report as incident if:** Messages are lost, delayed unreasonably, or delivered to the wrong teacher.

## 8. Daily Pilot Evidence Log

Copy this into a spreadsheet (one row per teacher command):

| Date | Teacher | Journey | Command/Task | Attempted? | Completed? | Fallback Used? | Response Time | Error? | Data Issue? | Teacher Assistance Required? | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | Y/N | Y/N | None/OpenAI/Gemini | mm:ss | Y/N | Y/N | Y/N | |

Fill this in daily, either live or by reviewing that day's Render logs in one pass. Keep it flat and simple — one sheet, one row per command, no separate tabs needed for a pilot this size.

## 9. Response-Time Measurement

**Method:** Use existing production logs — no new instrumentation is added or required. Measure **teacher-visible end-to-end response time**: from the teacher's message hitting the webhook to the response (and PDF, where applicable) being delivered back.

**What to record per sample:**
- Processing/receipt time — timestamp of `[WEBHOOK] Processing message ${messageId} from ...NNNN`
- Delivery time — timestamp of `[WEBHOOK] Response delivered to ...NNNN` (or the PDF-sent log line if it arrives later)
- Response duration — delivery time minus processing time
- Command type (worksheet, lesson plan, etc.)
- Success/failure

**How to handle edge cases:**
- **Successful responses:** Time normally, as above.
- **Failed requests/timeouts:** Exclude from the response-time average entirely; count only in the completion-rate denominator as a failure. A 60-second timeout should never be averaged in as if it were a real 60-second response.
- **PDF responses:** Use the PDF-sent log line as the true completion event if it lands after the text response — the teacher's journey isn't finished until they can actually use the PDF.
- **Retries** (e.g., an internal correction the system makes on its own, like an ATP week-range fix): Time the single outer teacher-visible request, not each internal retry separately.
- **Duplicate messages:** A message the system logs as `[WEBHOOK] Duplicate message ignored` is not a new attempt and must not be timed or counted again.
- **Ambiguous concurrent requests:** With only phone-suffix and log order to pair receipt/delivery lines, two overlapping messages from the same teacher can be impossible to pair reliably. If a pair looks ambiguous, exclude that sample rather than guessing — this should be rare at 5–10 teacher scale.

## 10. Command Completion Tracking

```
Completion Rate = Completed Commands / Attempted Commands × 100
```

**Counting rules:**
- **Successful Gemini fallback:** Counts as a completed command. The fact that Gemini served it (rather than Anthropic/OpenAI) is tracked separately as a fallback note, not treated as a partial success or failure.
- **Provider fallback (any provider succeeding after an earlier one failed):** Same rule — the command completed, note which provider closed it out.
- **Total AI failure (all configured providers fail):** Counts as an attempted-but-not-completed command.
- **Duplicate incoming messages:** Not counted at all — neither attempted nor completed, since the system itself recognized and discarded them.
- **Retries (internal, single teacher-visible request):** Counted once, as one attempt with one outcome — not once per internal retry.

## 11. Data Integrity Checks

Run this checklist weekly (or more often if something looks off):

- [ ] **Duplicate resources:** Spot-check for the same generated resource (worksheet, plan, report) saved more than once for a single request.
- [ ] **Missing resources:** Confirm a resource a teacher believes they generated is actually retrievable afterward.
- [ ] **Learner/teacher ownership:** Confirm learner records and marks are attributed to the correct teacher.
- [ ] **Marks/results integrity:** Spot-check that recorded marks match what was actually entered/generated.
- [ ] **Cross-teacher visibility:** Confirm no teacher can see another teacher's data via dashboard or API responses.
- [ ] **Orphaned records:** Check for leftover partial records from a failed mid-flow generation (e.g., a resource row with no matching content).
- [ ] **Assessment integrity:** Confirm assessment/rubric outputs are internally consistent (correct grade, subject, mark totals).

This is a manual review process against existing data — no new tooling or code is introduced to perform it.

## 12. Stability Monitoring

Watch Render logs and Sentry for the duration of the pilot. Distinguish clearly between:

- **Expected, recovered provider failure:** Anthropic and/or OpenAI failing, followed by a successful Gemini generation (`[AI] Gemini generation succeeded`). This is expected under current billing conditions and is **not** a stability incident — just log the fallback.
- **Genuine application failure:** All configured providers exhausted for a single request, resulting in an apology/rollback message to the teacher. This **does** count against completion and should be noted.
- **Repeated errors:** The same error occurring more than once with the same root cause signals a real, distinct bug — worth flagging even if each individual instance "recovered."
- **Crashes:** Any `uncaughtException` or `unhandledRejection` reaching Sentry. Given the global handlers are in place, this should be zero — treat any occurrence as a priority incident.
- **Infrastructure issues:** Render-side problems (deploy failures, service restarts outside of an intentional deploy, disk issues) — track separately from application-level errors.

## 13. Teacher Assistance Log

| Date | Teacher | Journey | Problem | What Teacher Expected | What Happened | Assistance Provided | Product Defect or Onboarding Issue? | Resolution | Follow-up Required? |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

Log every instance where a teacher reaches out for help completing something — even if the underlying command technically "succeeded." A pattern of the same confusion across multiple teachers is a real usability signal regardless of technical success.

## 14. Incident Severity

- **Critical:** Data corruption, cross-teacher data leakage, or a crash loop. **Pause the pilot immediately** if any of these occur.
- **High:** A journey is completely unusable for a teacher (not just slow or degraded), or repeated total AI failures across multiple teachers.
- **Medium:** A single teacher experiences a real defect that is inconvenient but has a workaround, or is isolated to one occurrence.
- **Low:** Minor UX friction, one-off confusion, or a cosmetic issue that doesn't block work.
- **Informational:** Expected provider fallback, known operational conditions (e.g., current Anthropic/OpenAI credit exhaustion), or notes with no action needed.

**Pause the pilot immediately** for any Critical incident. Do not wait for the daily or weekly review to act on those.

## 15. Rollback / Emergency Procedure

Use the existing RC1 rollback principles as-is — nothing new is introduced here:

1. Disable the WhatsApp webhook if necessary.
2. Restore the known-good deployment.
3. Restore the database if required.
4. Notify pilot teachers.
5. Record the critical incident in full.
6. Resume the pilot only after fresh RC1 approval.

## 16. Daily Operating Routine

- **Day 1:** Complete Teacher Onboarding Checklist (Section 6) for all pilot teachers. Confirm each teacher completes one basic first task successfully before end of day.
- **Days 2–13 (daily):**
  - Review the day's Render logs; fill in the Daily Pilot Evidence Log (Section 8).
  - Check for any incidents; classify severity (Section 14) and log anything Medium or above.
  - Spot-check response times for that day's AI-generation commands.
  - Note any teacher assistance requests (Section 13) as they happen.
- **Every 3–4 days:** Run a Data Integrity spot-check (Section 11).
- **Weekly (end of Day 7 and Day 14):**
  - Review the week's evidence log as a whole — completion rate so far, response-time trend, open incidents.
  - Check in briefly with each teacher for informal feedback (what's working, what's frustrating).
  - Confirm no unresolved incidents are being silently carried forward.

This routine is scoped for one project owner managing the pilot manually — no dashboard or automation is required.

## 17. Day-14 Final Evaluation

At the end of the pilot, compile:

- [ ] Total attempted commands
- [ ] Total completed commands
- [ ] Completion percentage
- [ ] Average response time
- [ ] Median response time
- [ ] Maximum response time
- [ ] Data integrity incidents (count and detail)
- [ ] Duplicated resources (count and detail)
- [ ] Crashes (count and detail — should be zero)
- [ ] AI total failures (count — all providers exhausted on a single request)
- [ ] Fallback count (how often Gemini was needed vs. Anthropic/OpenAI succeeding directly)
- [ ] Teacher assistance incidents (count and pattern review)
- [ ] Unresolved incidents (any still open)
- [ ] Teacher independence assessment (can teachers work unaided, based on the assistance log pattern)

## 18. Final RC1 Decision

- **PASS** — RC1 evidence meets the success criteria (Section 5) and no unresolved blocking issue exists.
- **CONDITIONAL PASS** — Core criteria are met, but non-blocking operational issues remain (e.g., Anthropic/OpenAI credits still not restored, minor onboarding friction noted but not resolved).
- **FAIL** — One or more blocking criteria fail (e.g., completion rate below 95%, any data corruption, any unexplained crash) or a critical unresolved defect exists.

## 19. Pilot Evidence Storage

Keep it simple — one folder, plain files:

```
/pilot-evidence/
  daily-logs/           (one spreadsheet, updated daily — Section 8 template)
  incident-log/         (one running log — Section 13 template + severity notes)
  teacher-feedback/      (brief weekly check-in notes)
  response-time-evidence/ (raw log excerpts or the timing sheet backing Section 9)
  final-rc1-report.md   (Day-14 evaluation, Section 17, and the final decision, Section 18)
```

No new tooling, dashboard, or database is required to support this structure — plain spreadsheets and markdown notes are sufficient at this scale.

## 20. Owner Rules

- Do not change production code during the pilot without recording the change and its reason.
- Do not silently alter pilot evidence.
- Do not count successful fallback requests as failures.
- Do not hide failed commands.
- Do not reopen closed audits without new evidence.
- Every material incident must be recorded.
- Pilot evidence must reflect actual teacher usage.

## 21. Pilot Quick Reference

- **Scope:** 5–10 teachers, 14 days, 7 journeys (no Yoco/payments).
- **Completion target:** ≥95% (fallback success counts; total-provider failure does not).
- **Response time target:** <10s average, teacher-visible, end-to-end.
- **Zero-tolerance items:** data corruption, duplicated resources, unexplained crashes.
- **Known condition going in:** Anthropic/OpenAI credit-exhausted, Gemini-only in practice — not a defect, but no live redundancy; watch closely.
- **Pause immediately if:** data corruption, cross-teacher leakage, or a crash loop occurs.
- **Log everything daily:** evidence log (Section 8), incidents (Section 14), teacher assistance (Section 13).
- **Never reclassify a real failure as a success**, and never treat a resolved fallback as a failure.
- **At Day 14:** compile Section 17, apply Section 18's decision criteria exactly as written.
