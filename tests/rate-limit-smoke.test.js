// Integration smoke test for Security Row 6 — rate limiting on /api and
// /api/auth (utils/teacherAuth.js's apiLimiter, routes/auth.js's
// authLimiter).
//
// Scope: this row only. Proves runtime throttle behavior through the real
// mounted express-rate-limit middleware and the real server.js route
// wiring — not source-text wiring (already proven statically by
// tests/pr17-api-teacher-auth-wiring.test.js and
// tests/pr21-auth-wiring.test.js) and not a general regression of /api or
// /api/auth business logic.
//
// No mocks/stubs of express-rate-limit, the limiter instances, Express
// middleware, or HTTP. server.js is spawned as a real child process (same
// pattern as tests/payment-webhook-smoke.test.js and
// tests/whatsapp-webhook-signature-smoke.test.js) with an isolated
// throwaway DB and port.
//
// Distinguishing "rejected by rate limiting" from "rejected by
// downstream auth/validation": every check below requires ALL of —
//   (a) HTTP status 429,
//   (b) the response body matches the limiter's own configured `message`
//       verbatim (apiLimiter: "Too many requests — please try again
//       later."; authLimiter: "Too many login attempts — please try again
//       later." — these two messages are deliberately distinct in
//       production, per utils/teacherAuth.js and routes/auth.js, so a
//       match also proves WHICH limiter fired),
//   (c) the `ratelimit-remaining` response header reads "0" (only set by
//       express-rate-limit itself, standardHeaders: true in both configs),
// A route returning 401 (missing auth) or 400 (invalid body) never
// satisfies these three together, so a false positive from downstream
// logic is not possible.
//
// Targets chosen to avoid side effects:
//   /api/classes (GET, no Authorization header) — reaches apiLimiter,
//     then requireTeacherAuth, which 401s before any business logic runs.
//   /api/auth/request-code (POST, no/invalid `phone` in body) — reaches
//     authLimiter, then handleRequestCode's own input check, which 400s
//     immediately before any DB write or outbound WhatsApp send.
//
// Efficiency: two short-lived server instances are used rather than one,
// specifically so each limiter's threshold can be proven from a fresh,
// uncontaminated counter — this is what makes the independence checks
// unambiguous in both directions, not just cheaper. Total requests: ~123
// across both instances; real HTTP over localhost, no artificial delay,
// runs in well under the 15-minute configured window (the window governs
// *reset* timing, not request throughput, so proving the count-based
// threshold does not require waiting out the window).

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const API_LIMIT = 100;   // utils/teacherAuth.js apiLimiter max
const AUTH_LIMIT = 20;   // routes/auth.js authLimiter max
const API_MESSAGE = 'Too many requests — please try again later.';
const AUTH_MESSAGE = 'Too many login attempts — please try again later.';

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

function getApi(port) {
  return request(port, { path: '/api/classes', method: 'GET' });
}

function postAuth(port) {
  const body = JSON.stringify({ phone: 123 }); // wrong type -> 400 from handler, no side effects
  return request(
    port,
    {
      path: '/api/auth/request-code',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
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
    console.log('SKIPPED: rate-limit-smoke.test.js (set RUN_SMOKE_TESTS=1 to run — spawns real server + better-sqlite3, ~123 real HTTP requests)');
    process.exit(0);
  }

  const PORT_A = 37000 + Math.floor(Math.random() * 500);
  const PORT_B = 37500 + Math.floor(Math.random() * 500);
  const DB_A = path.join(__dirname, `.ratelimit-smoke-a-${Date.now()}.db`);
  const DB_B = path.join(__dirname, `.ratelimit-smoke-b-${Date.now()}.db`);

  // ── Server A: /api threshold + independence (api exhaustion -> auth fresh) ──
  await withServer(PORT_A, DB_A, async () => {
    let sawEarly429 = false;
    let lastStatus = null;
    for (let i = 0; i < API_LIMIT; i++) {
      const res = await getApi(PORT_A);
      if (res.status === 429) sawEarly429 = true;
      lastStatus = res.status;
    }
    check(
      `/api: ${API_LIMIT} requests within limit are not rate-limited`,
      !sawEarly429,
      `a 429 appeared before request ${API_LIMIT}; last status ${lastStatus}`
    );

    const overLimitRes = await getApi(PORT_A);
    check(
      `/api: request ${API_LIMIT + 1} is rejected by the rate limiter (429, correct message, ratelimit-remaining=0)`,
      isRateLimited(overLimitRes, API_MESSAGE),
      `status=${overLimitRes.status} body=${overLimitRes.body} remaining=${overLimitRes.headers['ratelimit-remaining']}`
    );

    // Independence check: apiLimiter is now exhausted. Confirm authLimiter's
    // budget is untouched — the FIRST /api/auth request on this server
    // (which has never hit /api/auth before) must NOT be rate-limited.
    const authRes = await postAuth(PORT_A);
    check(
      '/api/auth: unaffected by /api exhaustion on the same server (independence, direction 1)',
      !isRateLimited(authRes, AUTH_MESSAGE) && authRes.status !== 429,
      `status=${authRes.status} body=${authRes.body}`
    );
  });

  // ── Server B: /api/auth threshold + independence (auth exhaustion -> api fresh) ──
  await withServer(PORT_B, DB_B, async () => {
    let sawEarly429 = false;
    let lastStatus = null;
    for (let i = 0; i < AUTH_LIMIT; i++) {
      const res = await postAuth(PORT_B);
      if (res.status === 429) sawEarly429 = true;
      lastStatus = res.status;
    }
    check(
      `/api/auth: ${AUTH_LIMIT} requests within limit are not rate-limited`,
      !sawEarly429,
      `a 429 appeared before request ${AUTH_LIMIT}; last status ${lastStatus}`
    );

    const overLimitRes = await postAuth(PORT_B);
    check(
      `/api/auth: request ${AUTH_LIMIT + 1} is rejected by the rate limiter (429, correct message, ratelimit-remaining=0)`,
      isRateLimited(overLimitRes, AUTH_MESSAGE),
      `status=${overLimitRes.status} body=${overLimitRes.body} remaining=${overLimitRes.headers['ratelimit-remaining']}`
    );

    // Independence check: authLimiter is now exhausted. Confirm apiLimiter's
    // budget is untouched — the FIRST /api request on this server (which
    // has never hit /api before) must NOT be rate-limited.
    const apiRes = await getApi(PORT_B);
    check(
      '/api: unaffected by /api/auth exhaustion on the same server (independence, direction 2)',
      !isRateLimited(apiRes, API_MESSAGE) && apiRes.status !== 429,
      `status=${apiRes.status} body=${apiRes.body}`
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
