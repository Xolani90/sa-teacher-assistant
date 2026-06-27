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
