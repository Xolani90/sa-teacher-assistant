'use strict';

const https   = require('https');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { hashPhone }  = require('../utils/usageTracker');
const { getDb }      = require('../utils/database');
const { encryptPhone, decryptPhone } = require('../utils/encryption');
const { parseSqliteUtc } = require('../utils/dateUtils');
const { sendMessage } = require('./whatsappService');

const YOCO_CHECKOUT_URL = 'https://payments.yoco.com/api/checkouts';

/**
 * Returns the Pro price in cents from environment at call time.
 * This prevents rejection of in-flight payments if price changes.
 *
 * @returns {number}
 */
function getProPriceCents() {
  return Math.round(parseFloat(process.env.PRO_PRICE_ZAR || '99') * 100);
}

// ── HTTP helper ────────────────────────────────────────────────────────────

/**
 * Makes a JSON POST request to the Yoco API.
 *
 * @param {string} url
 * @param {Object} payload
 * @param {string} secretKey
 * @param {string} [idempotencyKey]
 * @returns {Promise<Object>}
 */
function yocoPost(url, payload, secretKey, idempotencyKey) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(payload);
    const parsed = new URL(url);

    const headers = {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization':  `Bearer ${secretKey}`,
    };

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname,
      method:   'POST',
      headers,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(result);
          } else {
            const msg = result?.message || result?.error || JSON.stringify(result).slice(0, 200);
            reject(new Error(`Yoco API ${res.statusCode}: ${msg}`));
          }
        } catch {
          reject(new Error(`Failed to parse Yoco response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.setTimeout(15_000, () => {
      req.destroy(new Error('Yoco API request timed out after 15s'));
    });

    req.on('error', (err) => reject(new Error(`Network error calling Yoco API: ${err.message}`)));
    req.write(body);
    req.end();
  });
}

// ── Create checkout ────────────────────────────────────────────────────────

/**
 * Creates a Yoco checkout session and returns the redirect URL.
 *
 * Deduplication: if a pending checkout was created for this teacher within
 * the last 30 minutes, re-use that checkout URL instead of creating a new
 * Yoco session. This prevents multiple pending subscription rows from
 * accumulating when a teacher clicks PRO repeatedly.
 *
 * Flow:
 *   Teacher replies PRO → we call this → send redirectUrl via WhatsApp
 *   Teacher pays → Yoco fires payment.succeeded → we mark Pro + send confirmation
 *
 * @param {string} phoneNumber  - Raw phone number (will be hashed)
 * @param {string} [teacherName]
 * @returns {Promise<{ redirectUrl: string, checkoutId: string }>}
 */
async function buildPaymentUrl(phoneNumber, teacherName = '') {
  const secretKey = process.env.YOCO_SECRET_KEY;
  const appUrl    = process.env.APP_URL;

  if (!secretKey) throw new Error('YOCO_SECRET_KEY not set');
  if (!appUrl)    throw new Error('APP_URL not set');

  const phoneHash = hashPhone(phoneNumber);
  const db        = getDb();

  // ── Deduplication: reuse recent pending checkout ─────────────
  // If a teacher clicks PRO multiple times before paying, we return the
  // same checkout URL rather than creating duplicate subscription rows.
  const existing = db.prepare(`
    SELECT yoco_checkout_id, phone_enc
    FROM subscriptions
    WHERE phone_hash = ?
      AND status = 'pending'
      AND created_at > datetime('now', '-30 minutes')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(phoneHash);

  if (existing?.yoco_checkout_id) {
    // We don't store the redirectUrl (Yoco doesn't return it on lookup).
    // We must call Yoco to retrieve it, OR we re-create a checkout with the
    // same idempotency key so Yoco de-dupes server-side.
    // Strategy: re-use idempotency key = existing yoco_checkout_id so Yoco
    // returns the same session if it hasn't expired.
    console.log(`[YOCO] Reusing existing pending checkout for hash ...${phoneHash.slice(-8)}`);
    // Fall through to create — Yoco's idempotency key ensures no double-charge.
    // The INSERT below uses OR IGNORE so no duplicate row is created.
  }

  // ── Encrypt phone for WhatsApp confirmation later ─────────────
  // Store the encrypted phone number in the subscription row so that
  // handleWebhookEvent can decrypt it and send a WhatsApp notification.
  const phoneEnc = encryptPhone(phoneNumber);

  // Also update teachers.phone_enc so renewal reminders can reach this teacher
  db.prepare(`
    INSERT OR IGNORE INTO teachers (phone_hash) VALUES (?)
  `).run(phoneHash);

  db.prepare(`
    UPDATE teachers SET phone_enc = ?, updated_at = datetime('now') WHERE phone_hash = ?
  `).run(phoneEnc, phoneHash);

  const idempotencyKey = existing?.yoco_checkout_id || uuidv4();

  // NOTE: Yoco auto-populates metadata.checkoutId on the resulting payment
  // object with its OWN real checkout ID (the same value as this response's
  // top-level `id` field) — it does not echo back arbitrary custom metadata
  // fields like phoneHash or teacherName on the payment.succeeded webhook.
  // We still send these fields for visibility in Yoco's own dashboard /
  // support tooling, but handleWebhookEvent() does NOT rely on Yoco
  // returning them — it looks up phoneHash from our own subscriptions row
  // via the real checkout ID instead. See handleWebhookEvent for details.
  const payload = {
    amount:     getProPriceCents(),
    // Currency cross-check note (Cycle 45 audit): handleWebhookEvent below
    // does not validate event.payload.currency against this value. Per
    // Yoco's own Create Checkout reference ("The 3-letter currency code in
    // ISO 4217 format. Currently we only support ZAR."), no other currency
    // can currently be returned for any checkout on this platform, so
    // there is no live cross-currency substitution path today. If Yoco
    // ever adds multi-currency support, this checkout-creation constant
    // and the webhook handler's amount floor would both need an explicit
    // currency check added — this is a documented forward-looking gap,
    // not a currently-exploitable one.
    currency:   'ZAR',
    cancelUrl:  `${appUrl}/payment/cancel`,
    successUrl: `${appUrl}/payment/return`,
    failureUrl: `${appUrl}/payment/failed`,
    metadata: {
      phoneHash,
      teacherName: teacherName.slice(0, 50) || 'Teacher',
      product:     'SA Teacher Assistant Pro',
    },
  };

  const response = await yocoPost(YOCO_CHECKOUT_URL, payload, secretKey, idempotencyKey);

  const redirectUrl = response.redirectUrl;
  const yocoId      = response.id;

  if (!redirectUrl) throw new Error('Yoco did not return a redirectUrl');

  // Insert new pending row only if no recent pending exists
  if (!existing) {
    db.prepare(`
      INSERT INTO subscriptions (phone_hash, yoco_checkout_id, amount_zar, status, phone_enc)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(phoneHash, yocoId, parseFloat(process.env.PRO_PRICE_ZAR || '99'), phoneEnc);
  } else {
    // Update the existing row with the new Yoco ID in case it changed
    db.prepare(`
      UPDATE subscriptions
      SET yoco_checkout_id = ?, updated_at = datetime('now')
      WHERE phone_hash = ? AND status = 'pending'
    `).run(yocoId, phoneHash);
  }

  console.log(`[YOCO] Checkout created: ${yocoId} for hash ...${phoneHash.slice(-8)}`);

  return { redirectUrl, checkoutId: yocoId };
}

// ── Webhook event handler ──────────────────────────────────────────────────

/**
 * Upgrades the teacher if the Yoco payment.succeeded event is valid.
 *
 * Signature verification is performed in server.js BEFORE this function
 * is called. This function handles business logic only:
 *   1. Validate payment amount (reject underpayments and test charges).
 *   2. Resolve the checkout ID to find which teacher this payment belongs to.
 *   3. Mark teacher as Pro in the DB.
 *   4. Send WhatsApp confirmation message.
 *
 * IMPORTANT — Yoco metadata behavior (confirmed against Yoco's official API
 * docs, since this is easy to get wrong and silently break every payment):
 *   - Yoco does NOT echo back arbitrary custom metadata fields (phoneHash,
 *     teacherName, product, etc.) on the payment.succeeded webhook payload.
 *   - The only metadata field Yoco reliably returns on the payment object is
 *     `checkoutId` — the same value returned as `id` when the checkout was
 *     created (e.g. "ch_9LVKD8GnAj7f39DFbn4F16bE").
 *   - Therefore we MUST resolve phoneHash by looking up our own
 *     `subscriptions` row via `yoco_checkout_id = metadata.checkoutId`,
 *     NOT by reading `metadata.phoneHash` directly off the webhook (which
 *     will always be undefined on a real Yoco payment and would silently
 *     fail to upgrade every single paying teacher).
 *   - Similarly, idempotency must be checked against the checkout ID, since
 *     that's the only stable identifier both the creation response and the
 *     webhook payload actually share. `event.payload.id` (the payment ID,
 *     prefixed "p_") is a DIFFERENT id space and is only used for logging
 *     here, never for DB lookups.
 *
 * @param {Object} event - Parsed Yoco webhook JSON body (already signature-verified)
 * @returns {{ phoneHash: string|null, upgraded: boolean }}
 */
async function handleWebhookEvent(event) {
  // ── Handle payment.failed ───────────────────────────────────────
  // Yoco sends this when a checkout doesn't complete — declined card,
  // failed 3D Secure, cancelled by the customer, etc. Previously this
  // was silently swallowed by the catch-all below, leaving the teacher
  // with no idea their payment didn't go through.
  if (event.type === 'payment.failed') {
    const checkoutId = event.payload?.metadata?.checkoutId;
    const failureReason = event.payload?.failureReason
      || event.payload?.status
      || 'unknown';

    if (!checkoutId) {
      console.warn(
        `[YOCO] payment.failed event missing metadata.checkoutId — cannot notify teacher. ` +
        `Reason: ${failureReason}`
      );
      return { phoneHash: null, upgraded: false };
    }

    const db = getDb();
    const subRow = db.prepare(`
      SELECT phone_hash, phone_enc FROM subscriptions
      WHERE yoco_checkout_id = ? AND status = 'pending'
    `).get(checkoutId);

    console.warn(`[YOCO] ✗ payment.failed — checkout ${checkoutId}, reason: ${failureReason}`);

    if (!subRow?.phone_hash) {
      console.warn(`[YOCO] No pending subscription found for failed checkout ${checkoutId} — cannot notify teacher.`);
      return { phoneHash: null, upgraded: false };
    }

    // Mark the row failed so it doesn't linger as 'pending' forever and
    // doesn't get mistaken for a duplicate-in-progress checkout later.
    db.prepare(`
      UPDATE subscriptions
      SET status = 'failed', updated_at = datetime('now')
      WHERE yoco_checkout_id = ? AND status = 'pending'
    `).run(checkoutId);

    const encPhone = subRow.phone_enc
      || db.prepare(`SELECT phone_enc FROM teachers WHERE phone_hash = ?`).get(subRow.phone_hash)?.phone_enc;
    const phone = decryptPhone(encPhone);

    if (phone) {
      try {
        await sendMessage(phone,
          `⚠️ *Payment didn't go through*\n\n` +
          `Your card wasn't charged — no need to worry, nothing was lost.\n\n` +
          `This usually happens if:\n` +
          `• The bank declined the card\n` +
          `• 3D Secure / OTP verification didn't complete\n` +
          `• The payment page was closed before finishing\n\n` +
          `Reply *PRO* to try again, ideally opened in your phone's browser rather than inside WhatsApp.\n\n` +
          `Still stuck? Reply *HELP* and we'll sort it out.`
        );
        console.log(`[YOCO] Sent payment-failed notice to ...${phone.slice(-4)}`);
      } catch (msgErr) {
        console.error('[YOCO] Failed to send payment-failed WhatsApp notice:', msgErr.message);
      }
    } else {
      console.warn(`[YOCO] No decryptable phone for hash ...${subRow.phone_hash.slice(-8)} — skipping payment-failed notice`);
    }

    return { phoneHash: subRow.phone_hash, upgraded: false };
  }

  // ── Only act on payment.succeeded beyond this point ────────────
  if (event.type !== 'payment.succeeded') {
    console.log(`[YOCO] Webhook event received: ${event.type} — no action needed`);
    return { phoneHash: null, upgraded: false };
  }

  // ── Resolve the checkout ID ────────────────────────────────────
  // This is the ONLY identifier reliably shared between checkout creation
  // and the payment webhook. event.payload.id is the payment's own ID
  // (different namespace) and is logged for traceability only.
  const paymentEventId = event.payload?.id; // e.g. "p_..." — for logging only
  const checkoutId = event.payload?.metadata?.checkoutId;

  if (!checkoutId) {
    console.warn(
      `[YOCO] payment.succeeded event missing metadata.checkoutId — cannot resolve which ` +
      `teacher this payment belongs to. Payment event ID: ${paymentEventId || 'unknown'}`
    );
    return { phoneHash: null, upgraded: false };
  }

  const db = getDb();
  const paidAmount = event.payload?.amount;

  // ── Idempotency anchor (Task 3): payment_ledger.checkout_id UNIQUE,
  // enforced via INSERT OR IGNORE. This is the primary mechanism relied on
  // for idempotency. The row is inserted immediately, before any business
  // logic, status 'received', so every webhook delivery is recorded even
  // before we know whether it will apply.
  //
  // Stale-reclaim rationale (Cycle 43 audit — see docs/releases history for
  // the full evidence trail):
  //
  //   External fact: Yoco's own developer docs (verifying-events) confirm
  //   webhook retries happen and recommend a 3-minute signature-replay
  //   threshold, but do NOT publish an exact retry schedule (attempt count,
  //   interval, or backoff) — there is no official source to size this
  //   2-minute value against.
  //
  //   Internal safety property (this is what actually justifies 2 minutes,
  //   not any assumption about Yoco's retry timing): the path from this
  //   INSERT to the terminal ledger status write below (`applied` /
  //   `ignored` / `failed`) contains zero `await` — confirmed by direct
  //   inspection, not measured/timed — so within one invocation nothing
  //   else can run between them. A second concurrent delivery for the same
  //   checkout_id therefore either arrives before this invocation starts
  //   (blocked by the UNIQUE constraint, ordinary duplicate) or after it
  //   has already reached a terminal status (also blocked). The only way a
  //   row can be found sitting at `received` by a later delivery is if the
  //   invocation that created it never reached a terminal status at all —
  //   an abrupt process kill, or an uncaught exception mid-function that
  //   this file's own catch-all (server.js) logs without terminal-marking
  //   the row. In either case that invocation is over; there is no live
  //   request left to "resume" after a later delivery reclaims the row.
  //
  //   So the 2-minute value is a recovery window for abandoned `received`
  //   rows, not a synchronization mechanism protecting one live request
  //   from a second one — it does not need to be sized against Yoco's
  //   retry cadence, only against this function's own execution shape.
  //   INSERT OR IGNORE would otherwise silently reject EVERY future
  //   delivery of that same checkout_id, with no reconciliation path
  //   anywhere in this codebase (confirmed: nothing else queries
  //   payment_ledger).
  const ledgerId = uuidv4();
  const insertResult = db.prepare(`
    INSERT OR IGNORE INTO payment_ledger (id, checkout_id, amount, status, created_at, updated_at)
    VALUES (?, ?, ?, 'received', datetime('now'), datetime('now'))
  `).run(ledgerId, checkoutId, typeof paidAmount === 'number' ? paidAmount : null);

  if (insertResult.changes === 0) {
    const existingLedgerRow = db.prepare(`
      SELECT status FROM payment_ledger WHERE checkout_id = ?
    `).get(checkoutId);

    if (existingLedgerRow?.status !== 'received') {
      // Terminal state (applied / ignored / failed) — genuine duplicate.
      console.log(
        `[YOCO] ledger_status=duplicate checkout_id=${checkoutId} phone_hash=unknown ` +
        `previous_expiry=n/a new_expiry=n/a delta_days=0 reason=checkout_already_in_ledger (terminal_status=${existingLedgerRow?.status})`
      );
      return { phoneHash: null, upgraded: false };
    }

    // Status is 'received' — either a concurrent in-flight call (reject)
    // or a stale, abandoned row from a crashed prior attempt (reclaim).
    const reclaim = db.prepare(`
      UPDATE payment_ledger
      SET updated_at = datetime('now')
      WHERE checkout_id = ? AND status = 'received' AND created_at < datetime('now', '-2 minutes')
    `).run(checkoutId);

    if (reclaim.changes === 0) {
      console.log(
        `[YOCO] ledger_status=duplicate checkout_id=${checkoutId} phone_hash=unknown ` +
        `previous_expiry=n/a new_expiry=n/a delta_days=0 reason=checkout_in_flight_or_recently_received`
      );
      return { phoneHash: null, upgraded: false };
    }

    console.warn(
      `[YOCO] ledger_status=reclaimed checkout_id=${checkoutId} reason=stale_received_row_reclaimed_for_retry`
    );
    // Fall through and process normally — the rest of this function does
    // not depend on insertResult, only on checkoutId/paidAmount, so a
    // reclaimed row proceeds through the exact same path as a fresh one.
  }

  console.log(
    `[YOCO] payment_received checkout_id=${checkoutId} amount=R${typeof paidAmount === 'number' ? (paidAmount / 100).toFixed(2) : 'unknown'} ` +
    `paymentEvent=${paymentEventId || 'unknown'} ledger_id=${ledgerId}`
  );

  // ── Amount validation ─────────────────────────────────────────
  // Reject underpayments and Yoco test-mode charges (which can have
  // arbitrary amounts). getProPriceCents() is the authoritative floor.
  if (typeof paidAmount !== 'number' || paidAmount < getProPriceCents()) {
    const reason = 'underpayment_or_invalid_amount';
    db.prepare(`
      UPDATE payment_ledger SET status = 'ignored', reason = ?, updated_at = datetime('now')
      WHERE checkout_id = ?
    `).run(reason, checkoutId);
    console.warn(
      `[YOCO] payment_no_op ledger_status=ignored checkout_id=${checkoutId} reason=${reason} ` +
      `paid=${paidAmount} required=${getProPriceCents()}`
    );
    return { phoneHash: null, upgraded: false };
  }

  // ── Resolve phoneHash via our own subscription row ─────────────
  // We stored phoneHash ourselves when the checkout was created — that's
  // the only place it lives now, since Yoco doesn't send it back to us.
  const subRow = db.prepare(`
    SELECT phone_hash, phone_enc FROM subscriptions
    WHERE yoco_checkout_id = ? AND status = 'pending'
  `).get(checkoutId);

  if (!subRow?.phone_hash) {
    const reason = 'no_pending_subscription_found';
    db.prepare(`
      UPDATE payment_ledger SET status = 'failed', reason = ?, updated_at = datetime('now')
      WHERE checkout_id = ?
    `).run(reason, checkoutId);
    console.warn(
      `[YOCO] payment_no_op ledger_status=failed checkout_id=${checkoutId} reason=${reason} ` +
      `payment_event=${paymentEventId || 'unknown'}`
    );
    return { phoneHash: null, upgraded: false };
  }

  const phoneHash = subRow.phone_hash;

  // ── Mark the checkout itself complete ──────────────────────────
  // (subscriptions row tracks checkout lifecycle for buildPaymentUrl's
  // 30-minute reuse window; payment_ledger above is the idempotency
  // anchor and audit trail — these are two distinct, intentionally
  // separate concerns.)
  db.prepare(`
    UPDATE subscriptions
    SET status = 'complete', updated_at = datetime('now')
    WHERE yoco_checkout_id = ? AND status = 'pending'
  `).run(checkoutId);

  // ── Task 1 + Task 4: the ENTIRE renewal — read, compute, write — happens
  // inside one SQLite transaction, with the expiry computation itself done
  // as a single atomic SQL expression (no JS-side read→compute→write gap).
  // db.transaction() is synchronous and holds a write lock for its full
  // duration, so no other writer (in-process or, if ever multi-instance,
  // cross-process under SQLite's own locking) can interleave between the
  // pre-update read and the write. The pre-update SELECT below is safe
  // specifically BECAUSE it is inside this same atomic boundary, not
  // because a SELECT is avoided entirely — SQLite's own UPDATE...RETURNING
  // cannot capture a true pre-update snapshot in one statement (a CTE
  // referencing the table is re-evaluated post-write, verified directly:
  // it returns the post-update value, not a frozen snapshot), so capturing
  // pro_expires_before requires a SELECT — which must therefore be inside
  // the transaction, not a separate round-trip outside it.
  const applyRenewal = db.transaction(() => {
    const before = db.prepare(`
      SELECT is_pro, pro_expires FROM teachers WHERE phone_hash = ?
    `).get(phoneHash);

    if (!before) {
      return { applied: false, reason: 'teacher_row_not_found', before: null, after: null };
    }

    const row = db.prepare(`
      UPDATE teachers
      SET is_pro = 1,
          is_pilot_account = 0,
          pro_expires = datetime(
            MAX(COALESCE(pro_expires, datetime('now')), datetime('now')),
            '+31 days'
          ),
          renewal_reminder_sent_at = NULL,
          updated_at = datetime('now')
      WHERE phone_hash = ?
      RETURNING pro_expires AS pro_expires_after
    `).get(phoneHash);

    if (!row) {
      // Matched zero rows despite the SELECT above finding one — only
      // reachable if the row was deleted between the two statements, which
      // cannot happen inside this same atomic transaction. Handled anyway
      // rather than assumed impossible.
      return { applied: false, reason: 'teacher_update_matched_zero_rows', before: before.pro_expires, after: null };
    }

    return { applied: true, reason: null, before: before.pro_expires, after: row.pro_expires_after };
  });

  const renewalResult = applyRenewal();

  if (!renewalResult.applied) {
    db.prepare(`
      UPDATE payment_ledger
      SET status = 'failed', reason = ?, phone_hash = ?,
          pro_expires_before = ?, updated_at = datetime('now')
      WHERE checkout_id = ?
    `).run(renewalResult.reason, phoneHash, renewalResult.before, checkoutId);

    console.error(
      `[YOCO] payment_no_op ledger_status=failed checkout_id=${checkoutId} phone_hash=...${phoneHash.slice(-8)} ` +
      `pro_extended_from=${renewalResult.before || 'null'} pro_extended_to=n/a previous_expiry=${renewalResult.before || 'null'} new_expiry=n/a delta_days=0 reason=${renewalResult.reason}`
    );
    return { phoneHash, upgraded: false };
  }

  const { before: expiresBefore, after: expiresAfter } = renewalResult;
  const deltaDays = Math.round(
    (parseSqliteUtc(expiresAfter).getTime() - (parseSqliteUtc(expiresBefore) || new Date()).getTime())
    / (24 * 60 * 60 * 1000)
  );

  db.prepare(`
    UPDATE payment_ledger
    SET status = 'applied', phone_hash = ?,
        pro_expires_before = ?, pro_expires_after = ?, updated_at = datetime('now')
    WHERE checkout_id = ?
  `).run(phoneHash, expiresBefore, expiresAfter, checkoutId);

  console.log(
    `[YOCO] payment_applied ledger_status=applied checkout_id=${checkoutId} phone_hash=...${phoneHash.slice(-8)} ` +
    `pro_extended_from=${expiresBefore || 'null'} pro_extended_to=${expiresAfter} previous_expiry=${expiresBefore || 'null'} new_expiry=${expiresAfter} delta_days=${deltaDays}`
  );

  // ── WhatsApp confirmation ─────────────────────────────────────
  // Task 5: use the EXACT value written inside the transaction above,
  // passed through function scope (expiresAfter) — no re-query of the DB,
  // no independent time computation.
  const encPhone = subRow.phone_enc
    || db.prepare(`SELECT phone_enc FROM teachers WHERE phone_hash = ?`).get(phoneHash)?.phone_enc;

  const phone = decryptPhone(encPhone);

  if (phone) {
    try {
      const expiryDate = parseSqliteUtc(expiresAfter);
      const formatted  = expiryDate.toLocaleDateString('en-ZA', {
        day: 'numeric', month: 'long', year: 'numeric',
      });

      await sendMessage(phone,
        `🎉 *Payment confirmed — you're now Pro!*\n\n` +
        `✅ Unlimited CAPS-aligned generations active\n` +
        `✅ PDF downloads for every worksheet, test & lesson plan\n` +
        `📅 Subscription valid until: ${formatted}\n\n` +
        `Start generating now — just type your request!\n` +
        `_Reply *HELP* for the full menu._`
      );

      console.log(`[YOCO] ✓ WhatsApp confirmation sent to ...${phone.slice(-4)}`);
    } catch (msgErr) {
      // Confirmation failure must NOT roll back the Pro upgrade.
      // The teacher is Pro — they just won't get the WhatsApp confirmation.
      console.error('[YOCO] Failed to send WhatsApp confirmation:', msgErr.message);
    }
  } else {
    console.warn(`[YOCO] No decryptable phone for hash ...${phoneHash.slice(-8)} — skipping WhatsApp confirmation`);
  }

  return { phoneHash, upgraded: true };
}

module.exports = { buildPaymentUrl, handleWebhookEvent };
