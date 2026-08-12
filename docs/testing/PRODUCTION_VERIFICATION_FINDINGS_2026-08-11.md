# Production Verification Findings — 2026-08-11

Status: **Deployment track PASS** · **Authentication track FAIL / BLOCKED**

No production code has been modified as part of this investigation. All findings below
are diagnostic only.

---

## Deployment track — PASS

Verified against `https://sa-teacher-assistant.onrender.com`:

1. `/` — serves the built dashboard SPA (was previously returning `404 ENOENT` because
   Render's manually-configured Build Command never ran `npm run build --prefix dashboard`;
   fixed by updating the Build Command to
   `npm install --build-from-source && npm install --prefix dashboard && npm run build --prefix dashboard`,
   confirmed via a clean deploy log and a subsequent `curl` returning real HTML with the
   expected built asset filenames).
2. `/healthz` — returns correct status JSON.
3. `/privacy` — unchanged, serves the real POPIA privacy policy.
4. Cold, logged-out deep link to `/classes/2` — correctly redirects to `/login` in a fresh
   incognito browser session, confirming SPA fallback + auth guard both function in
   production.

---

## Authentication track — FAIL / BLOCKED

### Finding 1 — OTP request endpoint intentionally returns generic success (by design)

`POST /api/auth/request-code` always returns `200 {"success": true}`, whether or not a
teacher record exists for the submitted phone number. This is a deliberate
anti-enumeration control: it prevents an unauthenticated caller from distinguishing
registered from unregistered numbers by observing the response. This is **not a defect**
and should not be weakened.

The trade-off is that this same design also hides genuine delivery failures from a
legitimate teacher, with no visible error and no in-app recovery guidance.

### Finding 2 — WhatsApp delivery-status webhooks are received but discarded

`routes/webhook.js` contains:

```js
// Ignore status updates (delivered, read receipts) — only process messages
if (value?.statuses) return;
```

Meta's WhatsApp Cloud API reports delivery outcomes (`sent`, `delivered`, `read`,
`failed`, including failure reason codes) asynchronously via this same webhook endpoint.
The application currently discards these payloads unread. This does not itself cause
message delivery to fail, but it means the application has no way to record or surface
*why* a message did not arrive, for this incident or any future one.

### Finding 3 — Root cause: free-form OTP delivery depends on an open WhatsApp customer-service session

**Evidence chain:**

- Production teacher record confirmed to exist for the test phone number
  (`getTeacherByPhone()` returns a match).
- `routes/auth.js` reaches the WhatsApp-send branch and calls `sendMessage()`.
- `sendMessage()` / `sendSingleMessage()` / `graphPost()` resolved without throwing.
- Direct raw Graph API calls (bypassing the app's abstraction entirely) confirmed Meta
  returns `HTTP 200` with a valid `wa_id` and message ID, in **both** local
  (`0782629774`) and international (`27782629774`) recipient formats — ruling out phone
  number normalization as a cause.
- Meta Business Manager confirmed production's `WHATSAPP_PHONE_NUMBER_ID`
  (`1229996043521347`) corresponds to the correct, healthy WABA: status **Connected**,
  quality rating **High**. A second, unrelated **Unverified** WABA also exists under the
  same business but uses a different phone number ID and is not the one production uses.
- With no open WhatsApp session (recipient had never messaged the business number), two
  independent free-form text messages were accepted by the API but never delivered.
- The recipient then sent a message *to* the business number, opening a 24-hour
  WhatsApp customer-service session.
- The identical `sendMessage()` call was repeated, with no code changes. The message
  was delivered.

**Conclusion, stated at three distinct levels (established fact vs. contributing gap vs. required fix):**

1. **Established root cause of the observed OTP failure:** The current OTP flow uses
   free-form WhatsApp text for an outbound-initiated authentication interaction.
   Controlled testing demonstrated that the same production sending mechanism
   (`sendMessage()`, unchanged) failed to deliver while the WhatsApp customer-service
   window was closed, and successfully delivered immediately after the recipient
   initiated a WhatsApp conversation with the business — with no other variable
   changed between the two attempts.

2. **Contributing observability defect:** Delivery-status webhook payloads
   (`sent` / `delivered` / `read` / `failed`) are discarded on receipt (Finding 2,
   above), preventing the application from recording Meta's downstream
   delivery/failure state. This did not cause the failure, but it means the
   application currently has no way to detect or diagnose this class of failure on
   its own — it required a manual Meta Business Manager investigation to establish.

3. **Required remediation:** Implement an approved WhatsApp **Authentication**
   template for first-contact OTP delivery (template messages are not subject to the
   24-hour session restriction that governs free-form text), and persist/process
   delivery-status webhooks so future failures — of this kind or otherwise — are
   diagnosable from application logs.

This does not yet prove the precise internal Meta failure classification (e.g. whether
Meta issues an asynchronous `failed` status with a specific reason code) — only that
session state is the controlling variable observed so far. Capturing status webhooks
(Finding 2) would give a more precise causal account going forward.

### Why this blocks production authentication

The current OTP flow is:

```
Teacher enters phone → app generates OTP → app sends free-form WhatsApp text → teacher enters OTP
```

This only works if the teacher already has an open WhatsApp session with the business
number. A first-time teacher — by definition — does not. This is a structural,
first-contact-onboarding problem, not an intermittent delivery inconvenience: any
teacher attempting to log in for the very first time is expected to have their OTP
silently fail to arrive, while `request-code` continues to report success by design
(Finding 1).

### Proposed remediation (not yet implemented, pending further investigation)

1. Replace first-contact OTP delivery with an approved WhatsApp **authentication/OTP
   message template**. Template messages are designed for business-initiated
   conversations and are not subject to the 24-hour session restriction that governs
   free-form text.
2. Implement persistence/logging of WhatsApp delivery-status webhook payloads
   (`sent` / `delivered` / `read` / `failed`, including failure reason where present),
   so future delivery failures are diagnosable from application logs rather than
   requiring a manual Meta Business Manager investigation like this one.

### Template investigation (completed)

Checked WhatsApp Manager → Message templates → Manage templates for this WABA
(`1229996043521347`, the confirmed production number). Result:

- **1 template exists total**: `hello_world`, category **Utility**, status
  "Active – Quality pending."
- **No Authentication-category template exists.**

Conclusion: this is not a configuration fix. An authentication-category template must
be created from scratch and submitted to Meta for approval before OTP delivery can be
made reliable for first-contact teachers. Meta's authentication template category has
fixed formatting requirements (a `{{1}}` OTP-code variable plus a copy-code or one-tap
autofill button; free-form custom wording is not permitted in this category), and
approval turnaround is outside this application's control.

### Not yet investigated

- Whether to also implement delivery-status webhook persistence (Finding 2) before or
  alongside the template work, so future failures of any kind are diagnosable without
  a manual Meta Business Manager investigation.

---

## Overall status

| Track | Status |
|---|---|
| Deployment (build, static serving, SPA fallback, auth guard) | **PASS** |
| WhatsApp OTP / authentication | **FAIL / BLOCKED** — pending template investigation and delivery-status logging before remediation |

Production readiness should **not** be marked PASS until the authentication track is
resolved and re-verified end-to-end with a real first-contact teacher login.
