'use strict';

/**
 * routes/auth.js — ADR-008 PR21: teacher JWT issuance.
 *
 * Introduces the missing half of ADR-008: `utils/teacherAuth.js` (PR16)
 * can verify a teacher JWT but nothing in the codebase could issue one.
 * This router closes that gap with exactly one responsibility: given a
 * proven teacher identity, sign a JWT that requireTeacherAuth already
 * knows how to accept. It does not implement identity proof itself.
 *
 * Mount contract (server.js): `/api/auth` is mounted WITHOUT
 * requireTeacherAuth and WITHOUT apiLimiter — a teacher cannot present a
 * JWT to obtain their first JWT. It gets its own, stricter authLimiter
 * instead (see below), matching the existing per-mount-point limiter
 * convention (webhookLimiter, adminLimiter, apiLimiter). This is
 * deliberately a sibling of routes/api.js, not a route added to it,
 * specifically so it never inherits /api's blanket auth gate.
 *
 * Identity verification is injected (createLoginHandler({
 * identityVerifier })), exactly like routes/api.js injects
 * getTeacherClasses/getTeacherLearners/etc. — so tests can stub it with
 * a plain function, no database required.
 *
 * The real wiring below (devIdentityVerifier) is a DEVELOPMENT-ONLY
 * stand-in: it trusts a bare `teacherId` in the request body with no
 * proof of identity whatsoever. It exists only so the JWT-issuance
 * contract (request/response shape, signing conventions) can be built
 * and tested before PR22 replaces the verifier with a real WhatsApp
 * OTP-based check. This endpoint MUST NOT be exposed to real teachers
 * or documented as a production login mechanism until that swap happens
 * — see PR22 (auth_codes, request-code/verify-code, sendMessage()
 * delivery, expiry, replay protection).
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
 * Builds the POST /login handler.
 *
 * @param {Object} deps
 * @param {(credentials: Object) => ({id:number, name:string|null}|null)} deps.identityVerifier
 *   Given the request body, returns the verified teacher ({id, name})
 *   or null/falsy if identity could not be established. Never throws
 *   for "identity not proven" — that's a normal outcome, not an error.
 * @returns {(req, res) => void}
 */
function createLoginHandler({ identityVerifier }) {
  /**
   * POST /api/auth/login
   *
   * @returns 401 (generic — no distinction between "unknown teacher" and
   *          "bad credential", same collapsed-reason posture as
   *          requireTeacherAuth) if identityVerifier returns falsy or throws
   * @returns 500 if TEACHER_JWT_SECRET is not configured, or if signing fails
   * @returns 200 { accessToken, tokenType, expiresIn, teacher: {id, name} }
   *          on success
   */
  return function handleLogin(req, res) {
    const secret = process.env.TEACHER_JWT_SECRET;

    if (!secret) {
      console.warn('[AUTH] TEACHER_JWT_SECRET not set in environment');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    let teacher;
    try {
      teacher = identityVerifier(req.body || {});
    } catch (err) {
      console.warn('[AUTH] identityVerifier failed:', err.message);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!teacher || !Number.isInteger(teacher.id) || teacher.id <= 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

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
  };
}

/**
 * DEVELOPMENT-ONLY identity verifier (PR21). Trusts a bare `teacherId`
 * in the request body — no credential, no proof. Looks the teacher up
 * directly (same pattern as teacherAuth.js's local resolveTeacherById:
 * a one-off auth-resolution lookup, not general enough to belong in a
 * shared repository module).
 *
 * PR22 replaces this entire function with WhatsApp OTP verification;
 * the route/handler contract above does not change.
 *
 * @param {{teacherId: number|string}} credentials
 * @returns {{id:number, name:string|null}|null}
 */
function devIdentityVerifier(credentials) {
  const { getDb } = require('../utils/database');
  const teacherId = Number(credentials.teacherId);
  if (!Number.isInteger(teacherId) || teacherId <= 0) return null;

  const db = getDb();
  const row = db.prepare('SELECT id, name FROM teachers WHERE id = ?').get(teacherId);
  if (!row) return null;
  return { id: row.id, name: row.name };
}

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
 * Generates a random 6-digit numeric OTP.
 *
 * @returns {string} 6-digit string
 */
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
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
    const { getTeacherByPhone } = require('../utils/usageTracker');
    const { hashPhone } = require('../utils/usageTracker');
    const { createAuthCode, deleteExpiredCodes } = require('../services/authCodeRepository');
    const { sendMessage } = require('../services/whatsappService');

    const teacher = getTeacherByPhone(phone);

    if (teacher) {
      const otp = generateOtp();
      const otpHash = hashOtp(otp);
      const phoneHash = hashPhone(phone);

      deleteExpiredCodes(phoneHash);

      const { getDb } = require('../utils/database');
      const expiresAt = getDb()
        .prepare(`SELECT datetime('now', '+${OTP_EXPIRY_MINUTES} minutes') AS ts`)
        .get().ts;

      createAuthCode(phoneHash, otpHash, expiresAt);

      try {
        await sendMessage(phone, `Your verification code is: ${otp}`);
      } catch (sendErr) {
        console.warn('[AUTH] Failed to send WhatsApp OTP:', sendErr.message);
      }
    }

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
    const { getTeacherByPhone } = require('../utils/usageTracker');
    const { hashPhone } = require('../utils/usageTracker');
    const { getActiveAuthCode, incrementAttempts, consumeAuthCode } = require('../services/authCodeRepository');

    const teacher = getTeacherByPhone(phone);
    if (!teacher) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const phoneHash = hashPhone(phone);
    const authCode = getActiveAuthCode(phoneHash);

    if (!authCode) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (authCode.attempts >= MAX_ATTEMPTS) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const suppliedHash = hashOtp(code);
    if (suppliedHash !== authCode.codeHash) {
      incrementAttempts(authCode.id);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const consumed = consumeAuthCode(authCode.id);
    if (!consumed) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

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

router.post('/login', createLoginHandler({ identityVerifier: devIdentityVerifier }));
router.post('/request-code', handleRequestCode);
router.post('/verify-code', handleVerifyCode);

module.exports = router;
module.exports.authLimiter = authLimiter;
module.exports.__testExports = {
  createLoginHandler,
  devIdentityVerifier,
  generateOtp,
  hashOtp,
  handleRequestCode,
  handleVerifyCode,
};
