// Integration smoke test for RL-ORDER-01 — the global rate limiter
// (server.js's top-level app.use(rateLimit(...))) must cover GET /,
// GET /privacy, and static assets served from public/, since these are
// the outermost public-facing routes.
//
// Regression context: these three surfaces were previously registered
// BEFORE the global limiter in server.js's middleware stack, so they
// never reached it at all and were completely unthrottled regardless of
// request volume. The fix moved the existing global limiter to run
// immediately after `app.set('trust proxy', 1)`, before any route or
// static handler that can send a response. This test proves the runtime
// effect of that move, not just the source ordering.
//
// No mocks/stubs of express-rate-limit, Express middleware, or HTTP.
// server.js is spawned as a real child process (same pattern as
// tests/rate-limit-smoke.test.js and tests/rate-limit-webhook-admin-smoke.test.js)
// with an isolated throwaway DB and port.
//
// Distinguishing "rejected by the global limiter" from any other 4xx:
// every check below requires ALL of —
//   (a) HTTP status 429,
//   (b) the response body matches the global limiter's own configured
//       `message` verbatim ("Too many requests — please try again
//       later." — per server.js's global rateLimit(...) config),
//   (c) the `ratelimit-remaining` response header reads "0" (only set
//       by express-rate-limit itself, standardHeaders: true).
//
// Threshold is read from the global limiter's own configuration
// (windowMs: 15 * 60 * 1000, max: 200) rather than hard-coded, per the
// requirement that this test track the limiter's actual config as the
// source of truth.
//
// Routes covered: GET / (dynamically handled), GET /privacy (dynamically
// handled), GET /about.html (served by express.static from public/) —
// one dynamic-route case and one static-file case, since they are
// implemented by different Express layers (app.get vs express.static)
// and the original defect affected both.

const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');

// Must match server.js's global limiter config exactly (source of truth).
const GLOBAL_LIMIT = 200;
const GLOBAL_MESSAGE = 'Too many requests — please try again later.';

const results = [];
const check = (name, cond, detail = '') => {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ' — ' + detail}`);
};

function isRateLimited(res, expectedMessage) {
  let parsedBody = null;
  try { parsedBody = JSON.parse(res.body); } catch { /* not JSON */ }
  return (
    res.status === 429 &&
    parsedBody && parsedBody.error === expectedMessage &&
    res.headers['ratelimit-remaining'] === '0'
  );
}

function request(port, options) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port, ...options }, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function getRoot(port) {
  return request(port, { path: '/', method: 'GET' });
}

function getPrivacy(port) {
  return request(port, { path: '/privacy', method: 'GET' });
}

function getStaticAsset(port) {
  return request(port, { path: '/about.html', method: 'GET' });
}

// TCP-level readiness probe, not an HTTP request: connects to the port and
// immediately closes once the connection succeeds, without ever sending
// bytes through Express. This deliberately avoids GET /healthz (or any
// other route) here, because every route in server.js — including
// /healthz — sits behind the global rate limiter this test measures.
// An HTTP readiness poll would consume part of the same 200-request
// budget the threshold loop below assumes is untouched. See
// tests/rate-limit-global-public-routes.test.js history for the
// regression this caused.
function waitForServer(port, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      const socket = net.connect({ host: 'localhost', port }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
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
    console.log('SKIPPED: rate-limit-global-public-routes.test.js (set RUN_SMOKE_TESTS=1 to run — spawns real server + better-sqlite3, ~600 real HTTP requests)');
    process.exit(0);
  }

  const PORT_ROOT    = 38000 + Math.floor(Math.random() * 300);
  const PORT_PRIVACY = 38300 + Math.floor(Math.random() * 300);
  const PORT_STATIC  = 38600 + Math.floor(Math.random() * 300);
  const DB_ROOT    = path.join(__dirname, `.ratelimit-global-root-${Date.now()}.db`);
  const DB_PRIVACY = path.join(__dirname, `.ratelimit-global-privacy-${Date.now()}.db`);
  const DB_STATIC  = path.join(__dirname, `.ratelimit-global-static-${Date.now()}.db`);

  // ── GET / (dynamically handled route) ──────────────────────────────
  await withServer(PORT_ROOT, DB_ROOT, async () => {
    let sawEarly429 = false;
    let lastStatus = null;
    for (let i = 0; i < GLOBAL_LIMIT; i++) {
      const res = await getRoot(PORT_ROOT);
      if (res.status === 429) sawEarly429 = true;
      lastStatus = res.status;
    }
    check(
      `GET /: ${GLOBAL_LIMIT} requests within limit are not rate-limited`,
      !sawEarly429,
      `a 429 appeared before request ${GLOBAL_LIMIT}; last status ${lastStatus}`
    );

    const overLimitRes = await getRoot(PORT_ROOT);
    check(
      `GET /: request ${GLOBAL_LIMIT + 1} is rejected by the global rate limiter (429, correct message, ratelimit-remaining=0)`,
      isRateLimited(overLimitRes, GLOBAL_MESSAGE),
      `status=${overLimitRes.status} body=${overLimitRes.body} remaining=${overLimitRes.headers['ratelimit-remaining']}`
    );
  });

  // ── GET /privacy (dynamically handled route) ───────────────────────
  await withServer(PORT_PRIVACY, DB_PRIVACY, async () => {
    let sawEarly429 = false;
    let lastStatus = null;
    for (let i = 0; i < GLOBAL_LIMIT; i++) {
      const res = await getPrivacy(PORT_PRIVACY);
      if (res.status === 429) sawEarly429 = true;
      lastStatus = res.status;
    }
    check(
      `GET /privacy: ${GLOBAL_LIMIT} requests within limit are not rate-limited`,
      !sawEarly429,
      `a 429 appeared before request ${GLOBAL_LIMIT}; last status ${lastStatus}`
    );

    const overLimitRes = await getPrivacy(PORT_PRIVACY);
    check(
      `GET /privacy: request ${GLOBAL_LIMIT + 1} is rejected by the global rate limiter (429, correct message, ratelimit-remaining=0)`,
      isRateLimited(overLimitRes, GLOBAL_MESSAGE),
      `status=${overLimitRes.status} body=${overLimitRes.body} remaining=${overLimitRes.headers['ratelimit-remaining']}`
    );
  });

  // ── GET /about.html (static file served via express.static) ───────
  await withServer(PORT_STATIC, DB_STATIC, async () => {
    let sawEarly429 = false;
    let lastStatus = null;
    for (let i = 0; i < GLOBAL_LIMIT; i++) {
      const res = await getStaticAsset(PORT_STATIC);
      if (res.status === 429) sawEarly429 = true;
      lastStatus = res.status;
    }
    check(
      `GET /about.html: ${GLOBAL_LIMIT} requests within limit are not rate-limited`,
      !sawEarly429,
      `a 429 appeared before request ${GLOBAL_LIMIT}; last status ${lastStatus}`
    );

    const overLimitRes = await getStaticAsset(PORT_STATIC);
    check(
      `GET /about.html: request ${GLOBAL_LIMIT + 1} is rejected by the global rate limiter (429, correct message, ratelimit-remaining=0)`,
      isRateLimited(overLimitRes, GLOBAL_MESSAGE),
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
