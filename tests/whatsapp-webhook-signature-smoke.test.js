// Integration smoke test for the WhatsApp webhook signature gate
// (utils/verifyWebhook.js, wired into server.js's express.json() `verify`
// callback for all paths under /webhook).
//
// Scope: Security Row 1 ("WhatsApp webhook signature validation") only.
// This proves the signature gate itself — accept/reject at the HTTP
// boundary — not downstream webhook business logic (intent parsing,
// WhatsApp replies, DB writes, AI calls, rate limiting). Those are
// explicitly out of scope here.
//
// Cases 1-4 spawn server.js as a real child process on a throwaway port
// with an isolated throwaway SQLite DB (same pattern as
// tests/payment-webhook-smoke.test.js), and fire real HTTP requests with
// genuine crypto.createHmac('sha256', ...) signatures computed over the
// exact raw request bytes — no mocking of the verifier, Express, HTTP, or
// crypto.
//
// Case 5 (missing META_APP_SECRET) cannot be proven through the full HTTP
// route: utils/validateEnv.js requires META_APP_SECRET at startup and
// calls process.exit(1) before the server ever listens if it's absent —
// so there is no HTTP boundary to hit in that condition. That case is
// instead proven by calling the real, unmodified verifyWebhookSignature()
// function directly (require, no mock) with META_APP_SECRET deleted from
// env, and asserting it throws with statusCode 500 — this is
// verifier-level proof, not route-boundary proof, and is labeled as such
// in the output.

const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = 36000 + Math.floor(Math.random() * 1000);
const SECRET = 'a'.repeat(64); // META_APP_SECRET is an arbitrary app secret, not whsec_-formatted
const TMP_DB = path.join(__dirname, `.whatsapp-sig-smoke-${Date.now()}.db`);

function sign(bodyString, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
}

function postWebhook(body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: '/webhook',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      const req = http.get({ host: 'localhost', port: PORT, path: '/healthz' }, res => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return reject(new Error('server did not start in time'));
        setTimeout(attempt, 150);
      });
    })();
  });
}

async function main() {
  if (!process.env.RUN_SMOKE_TESTS) {
    console.log('SKIPPED: whatsapp-webhook-signature-smoke.test.js (set RUN_SMOKE_TESTS=1 to run — spawns real server + better-sqlite3)');
    process.exit(0);
  }

  const results = [];
  const check = (name, cond, detail = '') => {
    results.push(cond);
    console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ' — ' + detail}`);
  };

  // ── Case 5: META_APP_SECRET absent — verifier-level proof only ──────────
  // Cannot be proven via HTTP: validateEnv() hard-exits the process before
  // the server ever binds a port when META_APP_SECRET is missing, so there
  // is no route boundary reachable in this condition.
  {
    delete require.cache[require.resolve('../utils/verifyWebhook')];
    const savedSecret = process.env.META_APP_SECRET;
    delete process.env.META_APP_SECRET;
    const { verifyWebhookSignature } = require('../utils/verifyWebhook');

    const fakeBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
    const fakeReq = {
      method: 'POST',
      headers: { 'x-hub-signature-256': sign(fakeBody.toString(), 'irrelevant') },
    };

    let threw = null;
    try {
      verifyWebhookSignature(fakeReq, {}, fakeBody);
    } catch (err) {
      threw = err;
    }

    check(
      '[VERIFIER-LEVEL] missing META_APP_SECRET → throws with statusCode 500',
      threw !== null && threw.statusCode === 500,
      threw ? `statusCode=${threw.statusCode} message=${threw.message}` : 'did not throw'
    );

    if (savedSecret !== undefined) process.env.META_APP_SECRET = savedSecret;
  }

  // ── Cases 1-4: real HTTP against the real /webhook route ────────────────
  let logs = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: TMP_DB,
      META_APP_SECRET: SECRET,
      PII_SECRET: process.env.PII_SECRET || 'a'.repeat(64),
      NODE_ENV: 'test',
    },
  });
  child.stdout.on('data', d => (logs += d.toString()));
  child.stderr.on('data', d => (logs += d.toString()));

  try {
    await waitForServer();

    const body = JSON.stringify({ object: 'whatsapp_business_account' });

    // Case 1: valid signature over the exact raw body → passes the gate.
    // We assert the signature gate specifically — not a full downstream
    // WhatsApp workflow result. The route handler calls res.sendStatus(200)
    // unconditionally as its very first line (acknowledge-first design,
    // before any body inspection), so a 200 alone would not distinguish
    // "passed the signature gate" from "signature check doesn't run at
    // all". The verifier is the only thing in this path that logs
    // '[SECURITY] ...rejected' — so absence of that log line, combined
    // with a non-403/non-500 status, is the actual evidence that the gate
    // was evaluated and passed, not bypassed.
    {
      const validSig = sign(body, SECRET);
      const res = await postWebhook(body, { 'x-hub-signature-256': validSig });
      const gateRejected = logs.includes('[SECURITY]') && logs.includes('rejected');
      check(
        'Case 1: valid signature — HTTP status is not 403/500',
        res.status !== 403 && res.status !== 500,
        `got ${res.status}`
      );
      check(
        'Case 1: valid signature — no [SECURITY] rejection logged by the verifier',
        !gateRejected,
        logs.slice(-500)
      );
    }

    // Case 2: signature computed over the ORIGINAL body, but body is tampered
    // before sending → HMAC no longer matches raw bytes → 403.
    {
      const originalBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
      const sigForOriginal = sign(originalBody, SECRET);
      const tamperedBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ injected: true }] });
      const res = await postWebhook(tamperedBody, { 'x-hub-signature-256': sigForOriginal });
      check('Case 2: tampered body with signature for original body → 403', res.status === 403, `got ${res.status}`);
    }

    // Case 3: syntactically-shaped but incorrect/garbage signature → 403.
    {
      const res = await postWebhook(body, { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) });
      check('Case 3: incorrect/garbage signature → 403', res.status === 403, `got ${res.status}`);
    }

    // Case 4: missing x-hub-signature-256 header entirely → 403.
    {
      const res = await postWebhook(body, {});
      check('Case 4: missing x-hub-signature-256 header → 403', res.status === 403, `got ${res.status}`);
    }
  } finally {
    child.kill('SIGTERM');
    try { fs.unlinkSync(TMP_DB); } catch {}
    try { fs.unlinkSync(TMP_DB + '-shm'); } catch {}
    try { fs.unlinkSync(TMP_DB + '-wal'); } catch {}
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n=== Results: ${passed}/${total} tests passed ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
