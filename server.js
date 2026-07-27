'use strict';

require('dotenv').config();

// ── Sentry (error monitoring) ──────────────────────────────────────────────
// Initialize before everything else so unhandled exceptions are captured.
// Set SENTRY_DSN in your environment to enable. If not set, monitoring is
// silently disabled — the app functions normally without it.
let Sentry = null;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn:         process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'production',
      // Capture 100% of transactions in production — adjust if volume is high
      tracesSampleRate: 0.1,
    });
    console.log('[SENTRY] Error monitoring enabled');
  } catch (e) {
    console.warn('[SENTRY] Could not initialise — install @sentry/node or check SENTRY_DSN');
  }
}

const { validateEnv }               = require('./utils/validateEnv');
const { verifyWebhookSignature }    = require('./utils/verifyWebhook');
const { runMigrations }             = require('./utils/database');
const { cleanupOldPdfs, getPdfPath } = require('./services/pdfService');
const { handleWebhookEvent }        = require('./services/yocoService');
const {
  getTeachersExpiringWithin,
  markRenewalReminderSent,
  markUserAsPro,
} = require('./utils/usageTracker');
const { decryptPhone } = require('./utils/encryption');
const { sendMessage }  = require('./services/whatsappService');

validateEnv();

// ── Global error safety net ─────────────────────────────────────────────────
// Node ≥ 15 terminates the process on unhandled promise rejections by default.
// Catch them here so we get a log entry and Sentry capture before any exit,
// rather than a cryptic crash with no context.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
  if (Sentry) Sentry.captureException(reason, { tags: { type: 'unhandledRejection' } });
  // Do NOT exit — Render will restart the process and the log gives context.
  // Exiting here would kill in-flight requests for all current users.
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message, err.stack);
  if (Sentry) Sentry.captureException(err, { tags: { type: 'uncaughtException' } });
  // For uncaught exceptions we DO exit — the process state is unknown.
  // Render restarts automatically within a few seconds.
  process.exit(1);
});

// ── Production DB path validation ─────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'teacher_assistant.db');
  const resolvedPath = path.resolve(dbPath);

  const persistentPaths = ['/data', '/db', '/var/lib', '/mnt'];
  const isPersistent = persistentPaths.some(p => resolvedPath.includes(p));

  if (!isPersistent) {
    console.error(`FATAL: DB_PATH "${resolvedPath}" does not appear to be a persistent volume. All teacher data will be lost on redeploy. Set DB_PATH to a mounted volume path.`);
    process.exit(1);
  }
}

runMigrations();

const express   = require('express');
const rateLimit = require('express-rate-limit');
const helmet    = require('helmet');
const path      = require('path');

const webhookRouter = require('./routes/webhook');
const apiRouter     = require('./routes/api');

const app = express();

// Trust Render's reverse proxy so express-rate-limit can read the real client
// IP from X-Forwarded-For. Without this, all requests appear to come from the
// same IP (the proxy) and rate limits fire incorrectly.
app.set('trust proxy', 1);

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Privacy page ─────────────────────────────────────────────────────────────
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

// ── Security ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── Admin authentication middleware ─────────────────────────────────────────
// Extracted to utils/adminAuth.js (ADR-007 PR10) so routes/api.js can reuse
// the identical check without requiring this file, which has module-load
// side effects (migrations, cron intervals, app.listen) unsafe for tests.
const { requireAdminSecret, adminLimiter } = require('./utils/adminAuth');

// ── Teacher authentication middleware (ADR-008, PR17) ───────────────────────
// /api is now teacher-facing (requireTeacherAuth), not admin-facing.
// /admin/stats and /admin/grant-pro remain on requireAdminSecret, unchanged.
const { requireTeacherAuth, apiLimiter } = require('./utils/teacherAuth');

// ── Rate limiting ──────────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  message: { error: 'Too many requests — please try again later.' },
}));

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  skip: (req) => req.method === 'GET',
});

// ── Body parsing ───────────────────────────────────────────────────────────
// Raw body captured for HMAC verification BEFORE parsing.
app.use('/webhook', webhookLimiter);

app.use('/payment/webhook',
  express.raw({ type: 'application/json' }),
  (req, _res, next) => {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body;
      try { req.body = JSON.parse(req.body.toString()); } catch { req.body = {}; }
    }
    next();
  }
);

app.use(express.json({
  limit: '10kb', // Meta webhook payloads are always <1kb; 10kb gives comfortable headroom
  verify: (req, res, buf) => {
    if (req.path.startsWith('/webhook')) {
      verifyWebhookSignature(req, res, buf);
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ── Health check ───────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.status(200).json({
    status:    'ok',
    service:   'SA Teacher Assistant',
    version:   '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── WhatsApp Webhook ───────────────────────────────────────────────────────
app.use('/webhook', webhookRouter);

// ── PDF download ───────────────────────────────────────────────────────────
app.get('/pdf/:fileId', (req, res) => {
  const { fileId } = req.params;
  const { t } = req.query;

  // Verify signed token
  if (!t) {
    return res.status(403).json({ error: 'Missing token' });
  }

  const crypto = require('crypto');
  const expectedToken = crypto.createHmac('sha256', process.env.PDF_SECRET)
    .update(fileId)
    .digest('hex')
    .slice(0, 16);

  if (t !== expectedToken) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  const filePath = getPdfPath(fileId);
  if (!filePath) return res.status(404).json({ error: 'PDF not found or expired.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="teacher-assistant.pdf"');
  res.sendFile(filePath);
});

// ── Payment return / cancel pages ──────────────────────────────────────────
app.get('/payment/return', (_req, res) => {
  res.send(`
    <!DOCTYPE html><html>
    <head><title>Payment Successful</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body{font-family:Arial,sans-serif;text-align:center;padding:60px 20px;background:#f0faf4;}
      .card{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 12px rgba(0,0,0,.08);}
      h1{color:#2e7d32;}p{color:#555;line-height:1.6;}
    </style></head>
    <body><div class="card">
      <h1>🎉 Payment Successful!</h1>
      <p>Your <strong>Pro subscription</strong> is now active.</p>
      <p>Return to WhatsApp — you'll receive a confirmation message shortly.</p>
      <p>Then just send any message to start generating unlimited CAPS-aligned content.</p>
      <p><em>Welcome to SA Teacher Assistant Pro! 🎓</em></p>
    </div></body></html>
  `);
});

app.get('/payment/cancel', (_req, res) => {
  res.send(`
    <!DOCTYPE html><html>
    <head><title>Payment Cancelled</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body{font-family:Arial,sans-serif;text-align:center;padding:60px 20px;background:#fff8f0;}
      .card{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 12px rgba(0,0,0,.08);}
      h1{color:#e65100;}p{color:#555;line-height:1.6;}
    </style></head>
    <body><div class="card">
      <h1>Payment Cancelled</h1>
      <p>No charge was made. You can upgrade at any time by replying <strong>PRO</strong> in WhatsApp.</p>
      <p>Your free generations for this month are still available.</p>
    </div></body></html>
  `);
});

app.get('/payment/failed', (_req, res) => {
  res.send(`
    <!DOCTYPE html><html>
    <head><title>Payment Didn't Go Through</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body{font-family:Arial,sans-serif;text-align:center;padding:60px 20px;background:#fff5f5;}
      .card{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 12px rgba(0,0,0,.08);}
      h1{color:#c62828;}p{color:#555;line-height:1.6;}
    </style></head>
    <body><div class="card">
      <h1>⚠️ Payment Didn't Go Through</h1>
      <p>No charge was made — nothing was lost.</p>
      <p>This can happen if your bank declined the card, or if 3D Secure / OTP verification didn't complete.</p>
      <p>Return to WhatsApp and reply <strong>PRO</strong> to try again — opening the link in your phone's browser (not inside WhatsApp) usually works best.</p>
    </div></body></html>
  `);
});

// ── Yoco payment webhook ───────────────────────────────────────────────────
// Yoco POSTs here after a payment completes.
// We respond 200 immediately (Yoco retries on non-2xx), then verify the
// Svix-style signature (webhook-id / webhook-timestamp / webhook-signature)
// and delegate to handleWebhookEvent() for business logic.
app.post('/payment/webhook', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately

  const webhookId        = req.headers['webhook-id'];
  const webhookTimestamp = req.headers['webhook-timestamp'];
  const webhookSignature = req.headers['webhook-signature'];
  const event             = req.body;

  if (!event || typeof event !== 'object') {
    console.warn('[YOCO-WEBHOOK] Received non-JSON body');
    return;
  }

  try {
    // ── Signature verification ─────────────────────────────────
    // Use the raw buffer captured by express.raw() to avoid key-ordering
    // differences between JSON.stringify and what Yoco actually sent.
    const { verifyYocoWebhook } = require('./utils/yocoWebhookVerifier');
    const rawBody       = req.rawBody || Buffer.from(JSON.stringify(event));
    const webhookSecret = process.env.YOCO_WEBHOOK_SECRET; // format: whsec_XXXXXXXX...

    const verdict = verifyYocoWebhook({
      headers: {
        'webhook-id': webhookId,
        'webhook-timestamp': webhookTimestamp,
        'webhook-signature': webhookSignature,
      },
      rawBody,
      secret: webhookSecret,
    });

    if (!verdict.valid) {
      const reasonLog = {
        missing_secret:    () => console.warn('[YOCO-WEBHOOK] reason=missing_secret — YOCO_WEBHOOK_SECRET not set — rejecting event'),
        malformed_secret:  () => console.error('[YOCO-WEBHOOK] reason=malformed_secret — check whsec_ prefix / base64 body on Render env vars — rejecting event'),
        missing_headers:   () => console.warn('[YOCO-WEBHOOK] reason=missing_headers — webhook-id/timestamp/signature absent — ignored'),
        replay_attack:     () => console.warn('[YOCO-WEBHOOK] reason=replay_attack — timestamp outside acceptable window — ignored'),
        invalid_signature: () => console.warn('[YOCO-WEBHOOK] reason=invalid_signature — signature mismatch — ignored'),
      };
      (reasonLog[verdict.reason] || (() => console.warn(`[YOCO-WEBHOOK] reason=${verdict.reason} — ignored`)))();
      return;
    }

    // ── Business logic (signature already verified above) ─────
    // handleWebhookEvent() is async — it sends a WhatsApp confirmation.
    const { phoneHash, upgraded } = await handleWebhookEvent(event);

    if (upgraded) {
      console.log(`[YOCO-WEBHOOK] Teacher ...${phoneHash?.slice(-8)} upgraded to Pro ✓`);
    }
  } catch (err) {
    console.error('[YOCO-WEBHOOK] Error processing event:', err.message);
    if (Sentry) Sentry.captureException(err, { tags: { component: 'yoco-webhook' } });
  }
});

// ── Admin: AI usage stats ──────────────────────────────────────────────────
// Shows today's AI call counts, cost ceiling status, and classifier health.
// Useful for spotting runaway loops or unusual usage patterns from Render dashboard.
app.get('/admin/stats', adminLimiter, requireAdminSecret, (_req, res) => {
  const { getStats } = require('./utils/aiCostMonitor');
  const stats = getStats();
  res.json({
    ai: stats,
    ceiling_reached: stats.total >= stats.ceiling,
    warn_threshold_reached: stats.total >= stats.warn,
    timestamp: new Date().toISOString(),
  });
});

// ── Admin: Grant Pro status ───────────────────────────────────────────────────
// Allows an admin to grant Pro status to a teacher by phone number.
// Requires ADMIN_SECRET in Authorization header.
app.post('/admin/grant-pro', adminLimiter, requireAdminSecret, async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Normalize phone number (ensure it starts with +)
    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    // Phone number format validation
    if (!/^\+?[1-9]\d{6,14}$/.test(normalizedPhone)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Grant Pro status (default 31 days)
    const { expiresAt } = markUserAsPro(normalizedPhone, 31);

    // Hash the phone for the response (don't return raw phone)
    const crypto = require('crypto');
    const phoneHash = crypto.createHash('sha256').update(normalizedPhone).digest('hex').slice(0, 16);

    res.json({
      success: true,
      phone: phoneHash,
      expiresAt: expiresAt.toISOString(),
    });

    console.log(`[ADMIN] Pro status granted to ${normalizedPhone} (hash: ...${phoneHash})`);
  } catch (err) {
    console.error('[ADMIN] Error granting Pro status:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── API: Learner intervention plan (ADR-007 PR10, teacher auth ADR-008 PR17) ─
// Third delivery surface for InterventionService's InterventionPlan[],
// alongside WhatsApp (PR8) and PDF (PR9). Now gated by requireTeacherAuth
// (per-teacher JWT) instead of the ADMIN_SECRET placeholder — see
// utils/teacherAuth.js and docs/adr/ADR-008 for the authentication design.
app.use('/api', apiLimiter, requireTeacherAuth, apiRouter);

// ── Error handlers ─────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  if (Sentry) Sentry.captureException(err);
  if (res.headersSent) return; // avoid double-send if a response already went out
  const statusCode = err.statusCode || 500;
  const message = statusCode < 500 ? err.message : 'Internal server error';
  res.status(statusCode).json({ error: message });
});

// ── PDF cleanup scheduler (hourly) ────────────────────────────────────────
setInterval(() => {
  try { cleanupOldPdfs(); } catch (e) { console.error('[CLEANUP]', e.message); }
}, 60 * 60 * 1000);

// ── Pro renewal reminder scheduler (daily) ────────────────────────────────
// Queries for Pro teachers expiring within 3 days.
// Sends a WhatsApp renewal reminder if one hasn't been sent in the last 24h.
// Requires teachers.phone_enc to be populated (set when teacher first messages).
async function sendRenewalReminders() {
  try {
    // Check current hour in SAST (UTC+2)
    const hourSAST = (new Date().getUTCHours() + 2) % 24;
    if (hourSAST < 7 || hourSAST > 19) {
      console.log('[RENEWAL] Outside sending hours — skipping');
      return;
    }

    const expiring = getTeachersExpiringWithin(3);
    if (expiring.length === 0) return;

    console.log(`[RENEWAL] ${expiring.length} teacher(s) expiring within 3 days`);

    for (const teacher of expiring) {
      const phone = decryptPhone(teacher.phone_enc);
      if (!phone) {
        console.warn(`[RENEWAL] No phone for hash ...${teacher.phone_hash.slice(-8)} — skipping`);
        markRenewalReminderSent(teacher.phone_hash); // Prevent re-query every 24h
        continue;
      }

      // Mark reminder sent BEFORE attempting WhatsApp send to prevent duplicates
      markRenewalReminderSent(teacher.phone_hash);

      try {
        const expiryDate  = new Date(teacher.pro_expires);
        const daysLeft    = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
        const formatted   = expiryDate.toLocaleDateString('en-ZA', {
          day: 'numeric', month: 'long', year: 'numeric',
        });

        await sendMessage(phone,
          `📅 *Pro subscription expiring soon*\n\n` +
          `Your SA Teacher Assistant Pro subscription expires in *${daysLeft} day${daysLeft === 1 ? '' : 's'}* (${formatted}).\n\n` +
          `Reply *PRO* to renew for another month at *R${process.env.PRO_PRICE_ZAR || 99}*.\n\n` +
          `_Stay Pro and keep generating unlimited CAPS-aligned content. 🎓_`
        );

        console.log(`[RENEWAL] ✓ Reminder sent to ...${phone.slice(-4)}`);
      } catch (sendErr) {
        console.error(`[RENEWAL] Failed to send reminder to ...${teacher.phone_hash.slice(-8)}:`, sendErr.message);
        // Do NOT revert the flag - this prevents duplicate reminders even on failure
        if (Sentry) Sentry.captureException(sendErr, { tags: { component: 'renewal-reminder' } });
      }
    }
  } catch (err) {
    console.error('[RENEWAL] Scheduler error:', err.message);
    if (Sentry) Sentry.captureException(err, { tags: { component: 'renewal-scheduler' } });
  }
}

// Run once at startup (catches any teachers who expired while server was down)
// then every 24 hours.
sendRenewalReminders();
setInterval(sendRenewalReminders, 24 * 60 * 60 * 1000);

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n[SERVER] ✓ SA Teacher Assistant running on 0.0.0.0:${PORT}`);
  console.log(`[SERVER]   WhatsApp webhook: POST /webhook`);
  console.log(`[SERVER]   Yoco webhook:     POST /payment/webhook`);
  console.log(`[SERVER]   Health:           GET  /\n`);
});

// ── Startup/shutdown diagnostics ────────────────────────────────────────────
// Added to debug a Render deploy where the log showed a successful
// app.listen() callback but Render's port-scan still reported "no open
// ports detected" minutes later. These handlers make it visible if the
// process exits, receives a signal, or hits an unhandled error/rejection
// after startup, rather than the process just going silent.
process.on('exit', (code) => {
  console.log('[SERVER] Process exiting:', code);
});

process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[SERVER] Unhandled rejection:', err);
});

// ── Graceful shutdown ───────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM received — shutting down gracefully');
  server.close(() => {
    console.log('[SERVER] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000); // Force exit after 10s
});

module.exports = app;
