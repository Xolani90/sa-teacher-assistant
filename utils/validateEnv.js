'use strict';

/**
 * Validates required environment variables on startup.
 * Throws a clear error with a fix message rather than silently failing at runtime.
 */
function validateEnv() {
  const REQUIRED = [
    { key: 'WHATSAPP_TOKEN',           hint: 'Meta Dashboard → Your App → WhatsApp → API Setup' },
    { key: 'WHATSAPP_PHONE_NUMBER_ID', hint: 'Meta Dashboard → Your App → WhatsApp → API Setup' },
    { key: 'VERIFY_TOKEN',             hint: 'Any secret string — must match Meta Dashboard webhook config' },
    { key: 'PDF_SECRET',               hint: 'Random secret for signing PDF download URLs — node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"' },
    { key: 'META_APP_SECRET',          hint: 'App Secret from Meta Dashboard → Settings → Basic' },
    { key: 'PII_SECRET',               hint: 'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' },
    { key: 'APP_URL',                  hint: 'Public HTTPS URL of this deployment, e.g. https://your-app.onrender.com' },
    { key: 'ADMIN_SECRET',             hint: 'Any strong random string — used to authenticate /admin/* endpoints' },
    { key: 'TEACHER_JWT_SECRET',       hint: 'Random secret for signing teacher JWTs — node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' },
  ];

  const AI_KEYS     = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
  const YOCO_KEYS   = ['YOCO_SECRET_KEY', 'YOCO_WEBHOOK_SECRET'];

  const errors  = [];
  const warnings = [];

  for (const { key, hint } of REQUIRED) {
    if (!process.env[key]) {
      errors.push(`  ✗ Missing ${key}\n    → ${hint}`);
    }
  }

  if (!AI_KEYS.some(k => process.env[k])) {
    errors.push(`  ✗ Missing AI key — set ANTHROPIC_API_KEY or OPENAI_API_KEY\n    → api.anthropic.com or platform.openai.com`);
  }

  const missingYoco = YOCO_KEYS.filter(k => !process.env[k]);
  if (missingYoco.length > 0) {
    warnings.push(`[ENV] ⚠  Yoco not fully configured — payment upgrades will not work.`);
    warnings.push(`[ENV]    Missing: ${missingYoco.join(', ')}`);
    warnings.push(`[ENV]    See portal.yoco.com → Developers → API Keys & Webhooks`);
  }

  // ── Yoco webhook secret: conditional + format validation ──────────────
  // If YOCO_SECRET_KEY is configured, the app is expected to accept live
  // payments, so a missing or malformed YOCO_WEBHOOK_SECRET is a hard error
  // (not just a warning) — otherwise webhooks are silently dropped forever
  // with no crash and no alert. Dev environments without Yoco at all are
  // unaffected, since this block only runs when YOCO_SECRET_KEY is present.
  const yocoApiKey       = process.env.YOCO_SECRET_KEY;
  const yocoWebhookSecret = process.env.YOCO_WEBHOOK_SECRET;

  if (yocoApiKey && !yocoWebhookSecret) {
    errors.push(
      '  ✗ YOCO_SECRET_KEY is configured but YOCO_WEBHOOK_SECRET is missing\n' +
      '    → Payment webhooks cannot be verified — see portal.yoco.com → Developers → Webhooks'
    );
  } else if (yocoWebhookSecret) {
    if (!yocoWebhookSecret.startsWith('whsec_')) {
      errors.push(`  ✗ YOCO_WEBHOOK_SECRET must start with 'whsec_'\n    → Copy the value exactly from portal.yoco.com → Developers → Webhooks`);
    } else {
      const encoded = yocoWebhookSecret.slice('whsec_'.length);
      let decoded;
      try {
        decoded = Buffer.from(encoded, 'base64');
      } catch (e) {
        decoded = Buffer.alloc(0);
      }
      if (decoded.length === 0) {
        errors.push(`  ✗ YOCO_WEBHOOK_SECRET contains an invalid Base64 payload\n    → Re-copy the value from portal.yoco.com → Developers → Webhooks`);
      }
    }
  }

  warnings.forEach(w => console.warn(w));

  if (errors.length > 0) {
    console.error('\n[ENV] ✗ Server cannot start — missing required environment variables:\n');
    errors.forEach(e => console.error(e));
    console.error('\n[ENV] Copy .env.example to .env and fill in all values.\n');
    process.exit(1);
  }

  console.log('[ENV] ✓ All required environment variables present');
}

module.exports = { validateEnv };
