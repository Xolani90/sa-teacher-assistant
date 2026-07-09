# Real Transaction Test — The One Thing Nothing Else Can Substitute For

Everything up to this point — my sandbox testing, Windsurf's local
verification — uses mocks or your local machine. This is different: it's
ONE real message through Meta's live infrastructure and ONE real payment
through Yoco's sandbox, hitting your actual deployed bot. Nothing simulates
this correctly; only this is this.

Do this AFTER the Windsurf local checklist passes, and AFTER deploying v16
to Render.

---

## Part A — Real WhatsApp message (5 minutes)

1. Confirm your Render deployment is live:
   ```
   curl https://your-app.onrender.com/
   ```
   Expect `{"status":"ok",...}`.

2. From your own phone, message your bot's WhatsApp number:
   ```
   Grade 7 maths worksheet on fractions
   ```

3. Watch Render's live log tail while you send it. You should see, in order:
   ```
   [WEBHOOK] Processing message wamid.XXXX from ...XXXX (type: text)
   [CLASSIFIER] ... (or no classifier log if it succeeds silently — check for fallback warnings)
   [AI] Generating with anthropic (intent: worksheet)
   ```

4. **What this proves that nothing else can:** Meta's real webhook delivery
   format, real signature, real message ID, hitting your real deployed
   server, with a real AI call. This is the actual first link in the chain
   that a sandbox cannot simulate, because Meta's exact payload quirks only
   show up from Meta itself.

5. Reply `HELP`, confirm the menu renders correctly on your phone (formatting,
   emoji, line breaks — WhatsApp's renderer can differ subtly from what you'd
   expect from reading the raw string).

**If this fails:** check Render logs for the exact error. Common first-time
issues are `WHATSAPP_PHONE_NUMBER_ID` mismatch or an expired temporary token
— both config issues, not code issues, but only a real message surfaces them.

---

## Part B — Real Yoco sandbox payment (10 minutes)

This is the step that directly tests the bug we just fixed. Use Yoco's
**test** secret key (`sk_test_...`) for this — it moves no real money but
exercises the exact same code path as a live payment.

1. Confirm your Render env vars have:
   - `YOCO_SECRET_KEY=sk_test_...` (test mode)
   - `YOCO_WEBHOOK_SECRET=...` (from Yoco dashboard → Webhooks → your endpoint)
   - Webhook URL registered in Yoco dashboard as:
     `https://your-app.onrender.com/payment/webhook`

2. From WhatsApp, message your bot:
   ```
   PRO
   ```
   You should get a reply with a Yoco checkout link.

3. Open that link, pay with Yoco's test card:
   ```
   Card number: 4111 1111 1111 1111
   Expiry: any future date
   CVV: any 3 digits
   ```
   (Confirm this is still Yoco's current test card at
   https://developer.yoco.com — test card numbers occasionally change.)

4. **Watch Render's live log tail during and after payment.** This is the
   exact moment that was broken before the v16 fix. You are specifically
   looking for this line:
   ```
   [YOCO] ✓ payment.succeeded — teacher ...XXXXXXXX upgraded to Pro (R99), checkout ch_XXXXXXXX, payment event p_XXXXXXXX
   ```

   If instead you see:
   ```
   [YOCO] payment.succeeded event missing metadata.checkoutId
   ```
   or no `[YOCO]` line at all — the fix didn't deploy correctly, or there's
   a webhook registration issue in the Yoco dashboard. Stop and investigate
   before testing further; do not assume it's fine.

5. Check your WhatsApp — you should receive:
   ```
   🎉 Payment confirmed — you're now Pro!
   ```
   within a few seconds of the payment completing.

6. Send another generation request and confirm you now get a PDF attached
   (Pro-only feature) — this proves `is_pro` actually flipped in the
   database, not just that a log line printed.

7. **Idempotency check (optional but recommended):** In the Yoco dashboard,
   find the webhook delivery for this payment and manually resend it (most
   payment dashboards have a "resend webhook" button for testing). Confirm
   you do NOT get a second WhatsApp confirmation message and Render logs
   show:
   ```
   [YOCO] Checkout ch_XXXXXXXX already processed — skipping duplicate webhook
   ```

---

## What "100%" actually means after this

If both Part A and Part B complete with the expected log lines, you have
now verified the thing that no AI tool — me, Windsurf, or anything else —
could verify on your behalf: that your specific Meta app configuration,
your specific Yoco account configuration, and the actual code all
correctly connect end to end. That combination is the real "100%," and
it only exists after you've personally watched it happen once.

After this passes once, you can trust the automated tests (`npm test`,
the smoke test script) to catch regressions on future changes — you don't
need to repeat this full real-money flow on every deploy. But this first
time, watching it work live, is the step that actually closes the loop.
