'use strict';

/**
 * routes/auth.js — ADR-008: teacher authentication (WhatsApp OTP).
 *
 * Mount contract (server.js): `/api/auth` is mounted WITHOUT
 * requireTeacherAuth and WITHOUT apiLimiter — a teacher cannot present a
 * JWT to obtain their first JWT. It gets its own, stricter authLimiter
 * instead (see below), matching the existing per-mount-point limiter
 * convention (webhookLimiter, adminLimiter, apiLimiter). This is
 * deliberately a sibling of routes/api.js, not a route added to it,
 * specifically so it never inherits /api's blanket auth gate.
 *
 * POST /request-code and POST /verify-code implement the WhatsApp OTP
 * flow: a teacher requests a one-time code, it's delivered via
 * sendMessage(), and verifying it issues a JWT.
 *
 * Claim shape signed here is deliberately minimal, matching what
 * requireTeacherAuth actually reads (utils/teacherAuth.js): only `sub`
 * (teacher.id). No phoneHash, role, or other claim is embedded in the
 * token — per ADR-008 §4.1, the middleware re-resolves phone_hash fresh
 * from the teachers table on every request rather than trusting
 * anything carried in the token payload. Signing options (HS256 via
 * TEACHER_JWT_SECRET, expiresIn: '1h') match tests/teacherAuth.test.js's
 * existing conventions exactly, so tokens issued here are accepted by
 * the middleware with no changes to it.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const router = express.Router();

const JWT_EXPIRES_IN = '1h';
const JWT_EXPIRES_IN_SECONDS = 3600;
const OTP_EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS = 5;

/**
 * Rate limiter for /api/auth — deliberately stricter than apiLimiter
 * (100/15min, sized for normal authenticated dashboard traffic).
 * A login endpoint is a more attractive brute-force target, so this
 * bounds credential-guessing/abuse independently of that limit.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  message: { error: 'Too many login attempts — please try again later.' },
});

/**
 * Generates a random 6-digit numeric OTP using a CSPRNG (ADR-XXX Decision 7).
 * Replaces Math.random() — length, charset, and range are unchanged.
 *
 * @returns {string} 6-digit string
 */
function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Hashes an OTP using HMAC-SHA256 with PII_SECRET.
 *
 * @param {string} otp
 * @returns {string} hex hash
 */
function hashOtp(otp) {
  return crypto
    .createHmac('sha256', process.env.PII_SECRET)
    .update(otp)
    .digest('hex');
}

/**
 * POST /api/auth/request-code
 *
 * Requests a WhatsApp OTP for login. Always returns the same generic
 * response whether the teacher exists or not (security: prevents phone
 * number enumeration).
 *
 * @returns 400 if request body is invalid
 * @returns 200 { success: true } always (even for unknown phones)
 * @returns 500 if server misconfiguration or unexpected error
 */
async function handleRequestCode(req, res) {
  const { phone } = req.body || {};

  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'Invalid request' });
  }

  try {
    const { getTeacherByPhone, hashPhone } = require('../utils/usageTracker');
    const {
      generateAuthCodeTransactionally,
      isLockedOut,
      isInCooldown,
    } = require('../services/authCodeRepository');
    const { recordSendResult } = require('../services/deliveryEventRepository');
    const { sendMessage } = require('../services/whatsappService');

    const teacher = getTeacherByPhone(phone);

    if (teacher) {
      const phoneHash = hashPhone(phone);

      // Lockout takes precedence over cooldown (§4.3) — both checks must
      // pass for generation to occur; an expired cooldown does not
      // override an active lockout. This must not be observable
      // externally: the response is the same generic 200 either way.
      // isLockedOut() also performs the §4.1 lockout-expiry full reset as
      // a side effect when the stored lockout has passed.
      if (isLockedOut(phoneHash)) {
        return res.status(200).json({ success: true });
      }
      if (isInCooldown(phoneHash)) {
        return res.status(200).json({ success: true });
      }

      const otp = generateOtp();
      const otpHash = hashOtp(otp);

      // RC1-H-003: physical deletion of expired auth_codes rows was removed
      // from this hot path — whatsapp_delivery_events references auth_codes
      // by FK with no ON DELETE clause, so deleting a row with delivery
      // history caused a 500 here. generateAuthCodeTransactionally() below
      // now retires (supersedes) the previous OTP for this phone — whether
      // still active or already expired — instead of relying on deletion,
      // which both avoids the FK violation and keeps the active-OTP
      // backstop index (idx_auth_codes_active_backstop) correctly vacated
      // for this INSERT. See docs/releases/RC1-MILESTONE.md Defect Log.
      const { getDb } = require('../utils/database');
      const expiresAt = getDb()
        .prepare(`SELECT datetime('now', '+${OTP_EXPIRY_MINUTES} minutes') AS ts`)
        .get().ts;

      // Generation success is defined precisely as this transaction
      // committing (§4.3) — it supersedes any prior active OTP, inserts
      // the new row, and starts the 60s cooldown, all atomically. Delivery
      // has not been attempted yet and cannot roll this back.
      const { id: authCodeId } = generateAuthCodeTransactionally(
        phoneHash,
        otpHash,
        expiresAt
      );

      // --- DEV-ONLY OTP BYPASS ---
      // Never active in production. Lets you test the login flow locally
      // without needing a working WhatsApp OTP message template.
      const isDev = process.env.NODE_ENV !== 'production';
      if (isDev) {
        console.log(`[AUTH][DEV ONLY] OTP for ${phone}: ${otp}`);
      }

      // Delivery is asynchronous and observational only (§3.1, §5) — it
      // happens strictly after the generation transaction above has
      // committed, and its outcome never affects OTP validity or the
      // cooldown already started. Both success and failure produce a
      // persisted diagnostic event tied to authCodeId.
      try {
        const sendResult = await sendMessage(phone, `Your verification code is: ${otp}`);
        const providerMessageId = sendResult?.messages?.[0]?.id || null;
        recordSendResult({
          authCodeId,
          phoneHash,
          providerMessageId,
          eventStatus: providerMessageId ? 'send_accepted' : 'send_failed',
          providerError: providerMessageId ? null : 'No message ID returned by provider',
        });
      } catch (sendErr) {
        console.warn('[AUTH] Failed to send WhatsApp OTP:', sendErr.message);
        // Send-failure diagnostic event (§5's explicit send-failure case):
        // recorded even though no provider message ID was ever issued.
        // The OTP generated above remains valid — this must never roll
        // back or invalidate it.
        recordSendResult({
          authCodeId,
          phoneHash,
          providerMessageId: null,
          eventStatus: 'send_failed',
          providerError: sendErr.message,
        });
      }

      return res.status(200).json({
        success: true,
        ...(isDev ? { devOtp: otp } : {}),
      });
    }

    // No teacher record → no OTP generated, so no phone cooldown/lockout
    // state is created or checked (§4.3) — request-code still returns the
    // same generic response per §3.2 (anti-enumeration, unchanged).
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[AUTH] request-code error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/auth/verify-code
 *
 * Verifies a WhatsApp OTP and issues a JWT on success.
 *
 * @returns 400 if request body is invalid
 * @returns 401 if verification fails (generic, no distinction between reasons)
 * @returns 200 { accessToken, tokenType, expiresIn, teacher: {id, name} } on success
 * @returns 500 if server misconfiguration or unexpected error
 */
async function handleVerifyCode(req, res) {
  const { phone, code } = req.body || {};

  if (!phone || typeof phone !== 'string' || !code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const secret = process.env.TEACHER_JWT_SECRET;
  if (!secret) {
    console.warn('[AUTH] TEACHER_JWT_SECRET not set in environment');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    const { getTeacherByPhone, hashPhone } = require('../utils/usageTracker');
    const {
      getActiveAuthCode,
      consumeAuthCode,
      isLockedOut,
      recordFailedAttempt,
      resetPhoneAuthState,
    } = require('../services/authCodeRepository');

    const teacher = getTeacherByPhone(phone);
    if (!teacher) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const phoneHash = hashPhone(phone);

    // Lockout is checked BEFORE looking at any OTP — while locked out,
    // verification remains blocked outright (§4.1). isLockedOut() also
    // performs the lockout-expiry full reset as a side effect.
    if (isLockedOut(phoneHash)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const authCode = getActiveAuthCode(phoneHash);

    if (!authCode) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // auth_codes.attempts is NOT authoritative for the 5-attempt security
    // limit (§4.2) — the sole authority is the phone-level state below.
    // This per-row field is retained only for backward-compatible shape,
    // never read or enforced against here.
    const suppliedHash = hashOtp(code);
    if (suppliedHash !== authCode.codeHash) {
      // Authoritative counter (§4.1/§4.2): persists across OTP
      // generations, not reset by requesting a new code, locks the phone
      // at the 5th failure.
      recordFailedAttempt(phoneHash, MAX_ATTEMPTS);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const consumed = consumeAuthCode(authCode.id);
    if (!consumed) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Successful-verification rule (§4.1, the entire rule): reset failed
    // count to 0 and clear lockout.
    resetPhoneAuthState(phoneHash);

    let accessToken;
    try {
      accessToken = jwt.sign({ sub: teacher.id }, secret, { expiresIn: JWT_EXPIRES_IN });
    } catch (err) {
      console.error('[AUTH] Token signing failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(200).json({
      accessToken,
      tokenType: 'Bearer',
      expiresIn: JWT_EXPIRES_IN_SECONDS,
      teacher: {
        id: teacher.id,
        name: teacher.name || null,
      },
    });
  } catch (err) {
    console.error('[AUTH] verify-code error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

router.post('/request-code', handleRequestCode);
router.post('/verify-code', handleVerifyCode);

module.exports = router;
module.exports.authLimiter = authLimiter;
module.exports.__testExports = {
  generateOtp,
  hashOtp,
  handleRequestCode,
  handleVerifyCode,
};
