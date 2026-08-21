// Integration smoke test for RC1 rate-limit behavioral coverage —
// webhookLimiter (server.js, mounted on /webhook) and adminLimiter
// (utils/adminAuth.js, mounted on /admin/stats and /admin/grant-pro).
//
// Scope: these two limiters only. The existing rate-limit criterion for
// apiLimiter/authLimiter (tests/rate-limit-smoke.test.js) is untouched and
// not reopened here. The global limiter (app.use(rateLimit(...)) applied
// to all routes) is intentionally excluded from RC1 behavioral scope per
// the RC1 scope decision — that exclusion does not mean the global
// limiter is tested, verified, or considered secure.
//
// No mocks/stubs of express-rate-limit, the limiter instances, Express
// middleware, or HTTP. server.js is spawned as a real child process (same
// pattern as tests/rate-limit-smoke.test.js) with an isolated throwaway
// DB and port.
//
// Distinguishing "rejected by rate limiting" from "rejected by
// downstream logic":
//   - webhookLimiter has no custom `message` configured in server.js, so
//     express-rate-limit's own default message string is used and sent
//     via response.send() as plain text (not JSON): "Too many requests,
//     please try again later." A match on that exact string, together
//     with status 429 and ratelimit-remaining: "0" (standardHeaders:
//     true), is what express-rate-limit itself produces — a downstream
//     401 (bad/missing signature) or 400 (malformed body) never
//     satisfies all three together.
//   - adminLimiter (utils/adminAuth.js) DOES set a custom `message`:
//     { error: "Too many admin requests — please try again later." },
//     sent as JSON. A downstream 401 from requireAdminSecret (invalid
//     Authorization header) never matches that body + 429 + remaining=0
//     together, and adminLimiter is mounted before requireAdminSecret on
//     both /admin/stats and /admin/grant-pro, so requests reach the
//     limiter without needing a real admin secret.
//
// Targets chosen to avoid side effects:
//   /webhook (GET) is explicitly skipped by webhookLimiter's own `skip`
//     config (skip: (req) => req.method === 'GET'), so this test uses
//     POST, which is not skipped. No valid Meta signature is sent — the
//     limiter fires before signature verification runs (it's mounted via
//     app.use('/webhook', webhookLimiter) ahead of app.use('/webhook',
//     webhookRouter)), and requests that stay under the limiter's
//     threshold simply fall through to a downstream signature-rejection
//     response, never reaching business logic.
//   /admin/stats (GET, no Authorization header) — reaches adminLimiter,
//     then requireAdminSecret, which 401s before any business logic
//     runs. Chosen over /admin/grant-pro (POST) to avoid any accidental
//     state-changing side effect even though requireAdminSecret would
//     reject it first.
//
// Efficiency: two short-lived server instances, one per limiter, each
// proven from a fresh, uncontaminated counter. Total requests: ~67
// across both instances; real HTTP over localhost, no artificial delay.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const WEBHOOK_LIMIT = 60; // server.js webhookLimiter max (per 60s window)
const ADMIN_LIMIT = 5;    // utils/adminAuth.js adminLimiter max (per 15min window)
const WEBHOOK_MESSAGE = 'Too many requests, please try again later.'; // express-rate-limit default, plain text
const ADMIN_MESSAGE = 'Too many admin requests — please try again later.'; // utils/adminAuth.js custom message, JSON

const results = [];
const check = (name, cond, detail = '') => {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ' — ' + detail}`);
};

function isRateLimitedPlainText(res, expectedMessage) {
  return (
    res.status === 429 &&
    res.body === expectedMessage &&
    res.headers['ratelimit-remaining'] === '0'
  );
}

function isRateLimitedJson(res, expectedMessage) {
  let parsedBody = null;
  try { parsedBody = JSON.parse(res.body); } catch { /* not JSON */ }
  return (
    res.status === 429 &&
    parsedBody && parsedBody.error === expectedMessage &&
    res.headers['ratelimit-remaining'] === '0'
  );
}

function request(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port, ...options },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function postWebhook(port) {
  // No valid Meta signature header on purpose — webhookLimiter is
  // mounted ahead of signature verification, so under-limit requests
  // fall through to a downstream signature rejection, never business
  // logic. Body content is irrelevant to the limiter itself.
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  return request(
    port,
    {
      path: '/webhook',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    body
  );
}

function getAdminStats(port) {
  // No Authorization header on purpose — adminLimiter is mounted ahead
  // of requireAdminSecret, so under-limit requests fall through to a
  // downstream 401, never real admin data.
  return request(port, { path: '/admin/stats', method: 'GET' });
}

function waitForServer(port, timeoutMs = 30000) {
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
      ADMIN_SECRET: process.env.ADMIN_SECRET || 'test-admin-secret-for-rate-limit-smoke',
      NODE_ENV: 'test',
    },
  });
}

async function withServer(port, dbPath, fn) {
  const child = spawnServer(port, dbPath);
  let logs = '';
  let exitInfo = null;
  child.stdout.on('data', d => (logs += d.toString()));
  child.stderr.on('data', d => (logs += d.toString()));
  child.on('exit', (code, signal) => { exitInfo = { code, signal }; });
  child.on('error', err => { logs += `\n[spawn error] ${err.stack || err}\n`; });
  try {
    try {
      await waitForServer(port);
    } catch (err) {
      // Surface the child's actual output on startup failure instead of
      // failing blind — a silent timeout here gives no signal on whether
      // the server crashed, threw, or just never bound the port.
      console.error(`\n--- child process output (port ${port}) ---\n${logs}\n--- child exit info: ${JSON.stringify(exitInfo)} ---\n--- end child process output ---\n`);
      throw err;
    }
    return await fn(logs);
  } finally {
    child.kill('SIGTERM');
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  }
}

async function main() {
  if (!process.env.RUN_SMOKE_TESTS) {
    console.log('SKIPPED: rate-limit-webhook-admin-smoke.test.js (set RUN_SMOKE_TESTS=1 to run — spawns real server + better-sqlite3, ~67 real HTTP requests)');
    process.exit(0);
  }

  const PORT_WEBHOOK = 38000 + Math.floor(Math.random() * 500);
  const PORT_ADMIN = 38500 + Math.floor(Math.random() * 500);
  const DB_WEBHOOK = path.join(__dirname, `.ratelimit-webhook-smoke-${Date.now()}.db`);
  const DB_ADMIN = path.join(__dirname, `.ratelimit-admin-smoke-${Date.now()}.db`);

  // ── Server A: webhookLimiter threshold ──────────────────────────────────
  await withServer(PORT_WEBHOOK, DB_WEBHOOK, async () => {
    let sawEarly429 = false;
    let lastStatus = null;
    for (let i = 0; i < WEBHOOK_LIMIT; i++) {
      const res = await postWebhook(PORT_WEBHOOK);
      if (res.status === 429) sawEarly429 = true;
      lastStatus = res.status;
    }
    check(
      `/webhook (POST): ${WEBHOOK_LIMIT} requests within limit are not rate-limited`,
      !sawEarly429,
      `a 429 appeared before request ${WEBHOOK_LIMIT}; last status ${lastStatus}`
    );

    const overLimitRes = await postWebhook(PORT_WEBHOOK);
    check(
      `/webhook (POST): request ${WEBHOOK_LIMIT + 1} is rejected by the rate limiter (429, default message, ratelimit-remaining=0)`,
      isRateLimitedPlainText(overLimitRes, WEBHOOK_MESSAGE),
      `status=${overLimitRes.status} body=${overLimitRes.body} remaining=${overLimitRes.headers['ratelimit-remaining']}`
    );

    // GET is explicitly skipped by webhookLimiter's own `skip` config —
    // confirm a GET is never throttled even immediately after POST
    // exhaustion, proving skip behavior rather than assuming it.
    const getRes = await request(PORT_WEBHOOK, { path: '/webhook', method: 'GET' });
    check(
      '/webhook (GET): never rate-limited, even immediately after POST exhaustion (skip config)',
      getRes.status !== 429,
      `status=${getRes.status} body=${getRes.body}`
    );
  });

  // ── Server B: adminLimiter threshold ────────────────────────────────────
  await withServer(PORT_ADMIN, DB_ADMIN, async () => {
    let sawEarly429 = false;
    let lastStatus = null;
    for (let i = 0; i < ADMIN_LIMIT; i++) {
      const res = await getAdminStats(PORT_ADMIN);
      if (res.status === 429) sawEarly429 = true;
      lastStatus = res.status;
    }
    check(
      `/admin/stats: ${ADMIN_LIMIT} requests within limit are not rate-limited`,
      !sawEarly429,
      `a 429 appeared before request ${ADMIN_LIMIT}; last status ${lastStatus}`
    );

    const overLimitRes = await getAdminStats(PORT_ADMIN);
    check(
      `/admin/stats: request ${ADMIN_LIMIT + 1} is rejected by the rate limiter (429, correct message, ratelimit-remaining=0)`,
      isRateLimitedJson(overLimitRes, ADMIN_MESSAGE),
      `status=${overLimitRes.status} body=${overLimitRes.body} remaining=${overLimitRes.headers['ratelimit-remaining']}`
    );
  });

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n=== Results: ${passed}/${total} tests passed ===`);
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
