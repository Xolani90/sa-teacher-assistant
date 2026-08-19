// Regression test for Row 9 (Security) — phone-number redaction in
// production logs, scoped narrowly to the /admin/grant-pro route.
//
// Background: recon for Row 9 found that server.js's /admin/grant-pro
// handler logged the full, unmasked phone number on success
// (`console.log(`[ADMIN] Pro status granted to ${normalizedPhone} ...`)`),
// even though the same route's HTTP response body correctly returned only
// a hash. Fixed to `...${normalizedPhone.slice(-4)}`, matching the
// project's existing last-4-digit masking convention used elsewhere
// (services/yocoService.js, core/messageProcessor.js, server.js's own
// renewal-reminder logging).
//
// Scope: this test proves only the logging defect described above. It
// does not re-litigate routes/api.js:309/:353 (createReflection /
// updateReflection err.message-to-client paths) — those were separately
// established during recon as controlled, hand-authored application
// validation messages, not raw DB/stack leakage, and are out of scope
// here.
//
// No mocks or stubs: server.js is spawned as a real child process (same
// pattern as tests/rate-limit-smoke.test.js and
// tests/whatsapp-webhook-signature-smoke.test.js), so the actual
// production route handler and its actual console.log call are what run
// and get captured — the test does not reimplement or simulate the
// logging logic.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Deliberately distinctive so a false-negative substring match elsewhere
// in server startup/DB logs is not plausible.
const TEST_PHONE = '+27831234599';
const LAST_FOUR = TEST_PHONE.slice(-4); // '4599'
const EXPECTED_HASH = crypto.createHash('sha256').update(TEST_PHONE).digest('hex').slice(0, 16);
const ADMIN_SECRET = 'test-admin-secret-for-log-redaction-check';

const results = [];
const check = (name, cond, detail = '') => {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ' — ' + detail}`);
};

function request(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port, ...options }, res => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function postGrantPro(port) {
  const body = JSON.stringify({ phone: TEST_PHONE });
  return request(
    port,
    {
      path: '/admin/grant-pro',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': ADMIN_SECRET,
      },
    },
    body
  );
}

function waitForServer(port, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      const req = http.get({ host: 'localhost', port, path: '/healthz' }, res => {
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

function spawnServer(port, dbPath) {
  return spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      META_APP_SECRET: process.env.META_APP_SECRET || 'a'.repeat(64),
      PII_SECRET: process.env.PII_SECRET || 'a'.repeat(64),
      ADMIN_SECRET,
      NODE_ENV: 'test',
    },
  });
}

async function withServer(port, dbPath, fn) {
  const child = spawnServer(port, dbPath);
  let logs = '';
  child.stdout.on('data', d => (logs += d.toString()));
  child.stderr.on('data', d => (logs += d.toString()));
  try {
    await waitForServer(port);
    return await fn(() => logs);
  } finally {
    child.kill('SIGTERM');
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  }
}

async function main() {
  if (!process.env.RUN_SMOKE_TESTS) {
    console.log('SKIPPED: admin-grant-pro-log-redaction.test.js (set RUN_SMOKE_TESTS=1 to run — spawns real server + better-sqlite3)');
    process.exit(0);
  }

  const PORT = 38000 + Math.floor(Math.random() * 500);
  const DB_PATH = path.join(__dirname, `.admin-grant-pro-redaction-${Date.now()}.db`);

  await withServer(PORT, DB_PATH, async getLogs => {
    const res = await postGrantPro(PORT);

    check('grant-pro request succeeded (200)', res.status === 200, `got ${res.status}: ${res.body}`);

    let parsedBody = null;
    try { parsedBody = JSON.parse(res.body); } catch { /* ignore */ }
    check(
      'response body returns hash, not raw phone',
      parsedBody && parsedBody.phone === EXPECTED_HASH,
      `expected phone=${EXPECTED_HASH}, got ${JSON.stringify(parsedBody)}`
    );

    // Give the async console.log a moment to flush into captured stdout.
    await new Promise(r => setTimeout(r, 200));
    const logs = getLogs();

    check(
      'full raw phone number is absent from server logs',
      !logs.includes(TEST_PHONE),
      'found the full TEST_PHONE string in captured stdout/stderr'
    );

    check(
      'masked last-4-digit form is present in server logs',
      logs.includes(`...${LAST_FOUR}`),
      `expected to find "...${LAST_FOUR}" in logs`
    );

    check(
      'existing phoneHash masked form is still present in server logs',
      logs.includes(`...${EXPECTED_HASH}`),
      `expected to find "...${EXPECTED_HASH}" in logs`
    );
  });

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${passed}/${total} assertions passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
