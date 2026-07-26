'use strict';

/**
 * Shared admin authentication for internal-only HTTP endpoints
 * (/admin/*, /api/*). Originally defined inline in server.js for
 * /admin/stats and /admin/grant-pro; extracted unchanged (ADR-007 PR10)
 * so routes/api.js can reuse the identical check without requiring
 * server.js itself, which runs migrations, starts cron intervals, and
 * calls app.listen() at module-load time and so can never be required
 * from a test process.
 *
 * This is a single shared-secret scheme, not per-teacher authentication.
 * There is currently no per-teacher HTTP identity anywhere in this
 * codebase — WhatsApp establishes identity via the sender's phone number
 * (verified by Meta), and the PDF download endpoint uses an unscoped
 * per-file HMAC token, not a teacher identity. Anything gated by
 * requireAdminSecret is trusted-internal-client only (dev tooling, an
 * admin dashboard operated by the product owner) — it must not be
 * exposed to teachers or any client that shouldn't see every learner's
 * data. A dedicated ADR should define real teacher authentication
 * (login/session/token issuance, teacher -> class -> learner ownership
 * checks) before any endpoint here is opened up beyond that.
 */

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

function requireAdminSecret(req, res, next) {
  const authHeader = req.headers['authorization'];
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret) {
    console.warn('[ADMIN] ADMIN_SECRET not set in environment');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Timing-safe comparison prevents timing-based secret enumeration attacks.
  // Both buffers must be the same byte length for timingSafeEqual to work.
  const provided = Buffer.from(authHeader);
  const expected = Buffer.from(adminSecret);

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  message: { error: 'Too many admin requests — please try again later.' },
});

module.exports = { requireAdminSecret, adminLimiter };
