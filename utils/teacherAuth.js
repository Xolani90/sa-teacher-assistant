'use strict';

/**
 * Teacher-facing JWT authentication middleware (ADR-008, PR16).
 *
 * This is the ONLY code in the codebase permitted to read the
 * Authorization header, verify a JWT, or know that "teacher HTTP
 * authentication" exists as a concept. Per ADR-008 §5.1's non-negotiable
 * invariant, no service may ever parse a JWT, inspect a request header,
 * or otherwise become aware that HTTP authentication exists —
 * `interventionService.js`, `learnerRepository.js`, etc. keep taking a
 * plain `phoneHash` argument exactly as they do today for WhatsApp.
 *
 * Authentication resolves identity. Authorization validates ownership.
 * This middleware does ONLY the former: it establishes "this request is
 * genuinely from teacher X" and attaches `req.teacher = { id, phoneHash }`.
 * It does not check whether teacher X owns any particular learner/class —
 * that stays inside the existing phoneHash-scoped queries in the
 * repository/service layer, unchanged (ADR-008 §8).
 *
 * Per ADR-008 §4.1, the JWT subject (`sub` claim) is `teachers.id` (the
 * existing surrogate PK), NOT `phone_hash`. `phone_hash` is an
 * implementation detail (HMAC of a normalized phone number under
 * PII_SECRET) that may need to change independently of issued tokens —
 * see ADR-008 §4.1 for the full reasoning. This middleware resolves
 * teacher.id -> phone_hash freshly on every request rather than trusting
 * a phone_hash embedded in the token itself.
 *
 * Scope (ADR-008, PR16 — infrastructure only):
 *   - Parse `Authorization: Bearer <token>`
 *   - Verify JWT signature + expiry
 *   - Resolve teacher.id -> phone_hash via the teachers table
 *   - Populate req.teacher = { id, phoneHash }
 *   - Reject: missing token, malformed header, invalid signature,
 *     expired token, unknown teacher
 *
 * Explicitly NOT in scope for this middleware or this PR:
 *   - Token issuance / login flow (ADR-008 §4.4 — deliberately deferred)
 *   - Refresh tokens
 *   - Wiring into server.js or replacing requireAdminSecret on /api
 *     (that's PR17)
 *   - Any change to services or routes
 */

const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { getDb } = require('./database');

/**
 * Looks up a teacher's phone_hash by their numeric id.
 * Kept local to this module rather than exported from a shared repository
 * module — this is purely an auth-resolution lookup, not a general-purpose
 * teacher accessor, and keeping it here avoids growing the service layer's
 * surface area for something that only this middleware needs.
 *
 * @param {number} teacherId
 * @returns {{ id: number, phoneHash: string } | null}
 */
function resolveTeacherById(teacherId) {
  const db = getDb();
  const row = db.prepare('SELECT id, phone_hash FROM teachers WHERE id = ?').get(teacherId);
  if (!row) return null;
  return { id: row.id, phoneHash: row.phone_hash };
}

/**
 * Extracts a bearer token from an Authorization header value.
 * Returns null if the header is missing or not in "Bearer <token>" form.
 *
 * @param {string|undefined} authHeader
 * @returns {string|null}
 */
function extractBearerToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Express middleware: verifies a teacher JWT and populates req.teacher.
 *
 * Responds 401 for any failure (missing/malformed header, invalid
 * signature, expired token, unknown teacher) rather than distinguishing
 * failure reasons in the response body — same posture as
 * requireAdminSecret, which also collapses every rejection reason to a
 * generic 401 to avoid giving a caller a probing oracle. Rejection
 * reasons are still logged server-side for debugging.
 *
 * Responds 500 if TEACHER_JWT_SECRET is not configured, matching
 * requireAdminSecret's handling of a missing ADMIN_SECRET.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireTeacherAuth(req, res, next) {
  const secret = process.env.TEACHER_JWT_SECRET;

  if (!secret) {
    console.warn('[TEACHER_AUTH] TEACHER_JWT_SECRET not set in environment');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const token = extractBearerToken(req.headers['authorization']);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch (err) {
    console.warn('[TEACHER_AUTH] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const teacherId = Number(payload.sub);
  if (!Number.isInteger(teacherId) || teacherId <= 0) {
    console.warn('[TEACHER_AUTH] Token has an invalid or missing subject claim');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let teacher;
  try {
    teacher = resolveTeacherById(teacherId);
  } catch (err) {
    console.error('[TEACHER_AUTH] Teacher lookup failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }

  if (!teacher) {
    console.warn(`[TEACHER_AUTH] Token subject ${teacherId} does not match any teacher`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.teacher = teacher;
  next();
}

/**
 * Rate limiter for the /api mount (PR17). adminLimiter (utils/adminAuth.js,
 * 5 req/15min) is sized for a trusted-internal-client shared secret, not
 * per-teacher traffic from many independent teachers — reusing it here
 * would make normal dashboard/app usage trip the limit. 100 req/15min is
 * generous enough for a single teacher's normal usage while still bounding
 * abuse from a single compromised/misbehaving token.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  message: { error: 'Too many requests — please try again later.' },
});

module.exports = { requireTeacherAuth, extractBearerToken, resolveTeacherById, apiLimiter };
