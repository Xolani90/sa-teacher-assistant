// Row 9 (Security) — "tokens/secrets never appear in logs" audit.
//
// Scope and evidence standard (read before interpreting results):
// this test proves the three audited production paths below do not emit
// six deliberately unique, per-run secret marker values in captured
// stdout/stderr under the specific failure conditions exercised. It does
// NOT prove that no secret can ever be logged anywhere in the codebase
// under any condition — that would require exhaustively exercising every
// code path, which is out of scope here (consistent with recon's
// original framing: no violating call site was found in a full static
// sweep, but there was zero prior runtime evidence; this test supplies
// that runtime evidence for the highest-risk real paths only).
//
// Real spawned server.js child process throughout. No mocks/stubs of
// requireAdminSecret, requireTeacherAuth, jsonwebtoken, or
// verifyYocoWebhook — same pattern as
// tests/admin-grant-pro-log-redaction.test.js and
// tests/row9-error-handler-audit.test.js.
//
// Three real paths exercised, each configured with its OWN unique
// secret value (not a placeholder) so the verification/error logic
// genuinely runs against that real value, and the test can reliably
// search logs for that exact value:
//
//   1. ADMIN_SECRET — real unique marker configured; request sent with a
//      DIFFERENT credential (real requireAdminSecret 401 rejection path,
//      utils/adminAuth.js).
//   2. TEACHER_JWT_SECRET — real unique marker configured; request sent
//      with an intentionally invalid/malformed JWT (real
//      requireTeacherAuth rejection path, utils/teacherAuth.js). This
//      also covers the secondary assertion that the resulting
//      jsonwebtoken err.message does not itself contain the secret
//      marker or the submitted token.
//   3. YOCO_WEBHOOK_SECRET — real unique, valid-FORMAT (`whsec_...`)
//      marker configured; request sent with a deliberately invalid
//      signature (real verifyYocoWebhook invalid_signature rejection
//      path, server.js's /payment/webhook handler). Per review: the
//      configured secret itself is a well-formed real value, not
//      deliberately malformed — only the submitted signature is wrong —
//      so the real verification logic runs end-to-end rather than
//      short-circuiting on a malformed-secret guard clause.
//
// Three additional secrets (META_APP_SECRET, PII_SECRET, an AI-key
// placeholder) are configured with their own unique markers for the
// full server lifetime (startup + all three requests above), so any
// accidental logging of them during normal startup/request handling is
// also caught, even though no dedicated failure path for them is
// separately exercised here.
//
// The test also separately asserts that expected DIAGNOSTIC messages
// (e.g. "reason=missing_secret", "Token verification failed") are
// allowed and in fact expected to appear — so a passing result reflects
// "the secret's VALUE never appears," not "no log line ever mentions
// that a secret-related event occurred."
//
// No production code is touched by this file. If it surfaces a real
// leak, that would need a separate, reviewed production fix — same
// discipline as the phone-redaction fix earlier in this row.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function uniqueMarker(label) {
  return `${label}-${crypto.randomBytes(12).toString('hex')}`;
}

// Unique per test run, not reused across earlier tests in this suite.
const ADMIN_SECRET = uniqueMarker('ADMSECRET');
const TEACHER_JWT_SECRET = uniqueMarker('JWTSECRET');
const YOCO_WEBHOOK_SECRET = `whsec_${uniqueMarker('YOCOSECRET')}`;
const META_APP_SECRET = uniqueMarker('METASECRET');
const PII_SECRET = uniqueMarker('PIISECRET');
const AI_KEY_PLACEHOLDER = uniqueMarker('AIKEY');

const ALL_SECRET_MARKERS = [
  ADMIN_SECRET,
  TEACHER_JWT_SECRET,
  YOCO_WEBHOOK_SECRET,
  META_APP_SECRET,
  PII_SECRET,
  AI_KEY_PLACEHOLDER,
];

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

// ── Path 1: ADMIN_SECRET — wrong credential against real requireAdminSecret ──
function postGrantProWrongCredential(port) {
  const body = JSON.stringify({ phone: '+27831230001' });
  return request(
    port,
    {
      path: '/admin/grant-pro',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': 'definitely-not-the-real-admin-secret',
      },
    },
    body
  );
}

// ── Path 2: TEACHER_JWT_SECRET — invalid JWT against real requireTeacherAuth ──
const INVALID_JWT = 'not.a.valid.jwt.token.at.all';
function getClassesInvalidJwt(port) {
  return request(port, {
    path: '/api/classes',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${INVALID_JWT}` },
  });
}

// ── Path 3: YOCO_WEBHOOK_SECRET — valid-format secret, invalid signature ──
function postYocoInvalidSignature(port) {
  const event = { type: 'payment.succeeded', payload: { id: 'test-event' } };
  const body = JSON.stringify(event);
  return request(
    port,
    {
      path: '/payment/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'webhook-id': 'msg_test123',
        'webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'webhook-signature': 'v1,definitely-not-a-real-signature',
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
      NODE_ENV: 'test',
      ADMIN_SECRET,
      TEACHER_JWT_SECRET,
      YOCO_WEBHOOK_SECRET,
      META_APP_SECRET,
      PII_SECRET,
      ANTHROPIC_API_KEY: AI_KEY_PLACEHOLDER,
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
    await new Promise(r => setTimeout(r, 300)); // let final stdout flush before we stop reading
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  }
}

async function main() {
  if (!process.env.RUN_SMOKE_TESTS) {
    console.log('SKIPPED: row9-secrets-log-audit.test.js (set RUN_SMOKE_TESTS=1 to run — spawns real server)');
    process.exit(0);
  }

  const PORT = 39100 + Math.floor(Math.random() * 400);
  const DB_PATH = path.join(__dirname, `.secrets-log-audit-${Date.now()}.db`);

  await withServer(PORT, DB_PATH, async getLogs => {
    // ── Path 1: ADMIN_SECRET ──
    const adminRes = await postGrantProWrongCredential(PORT);
    check(
      '[Path 1] wrong admin credential is rejected (401)',
      adminRes.status === 401,
      `got ${adminRes.status}: ${adminRes.body}`
    );

    // ── Path 2: TEACHER_JWT_SECRET ──
    const jwtRes = await getClassesInvalidJwt(PORT);
    check(
      '[Path 2] invalid JWT is rejected (401)',
      jwtRes.status === 401,
      `got ${jwtRes.status}: ${jwtRes.body}`
    );

    // ── Path 3: YOCO_WEBHOOK_SECRET ──
    const yocoRes = await postYocoInvalidSignature(PORT);
    check(
      '[Path 3] Yoco webhook acknowledges with 200 regardless of signature validity (acknowledge-first design)',
      yocoRes.status === 200,
      `got ${yocoRes.status}: ${yocoRes.body}`
    );

    // Give async logging (Yoco path is processed after the immediate
    // res.sendStatus(200)) a moment to flush.
    await new Promise(r => setTimeout(r, 300));
    const logs = getLogs();

    // ── Primary assertions: none of the six real secret values ever appear ──
    for (const marker of ALL_SECRET_MARKERS) {
      check(
        `secret marker is absent from captured logs (${marker.split('-')[0]})`,
        !logs.includes(marker),
        `found "${marker}" in captured stdout/stderr`
      );
    }

    // ── Secondary assertion: jsonwebtoken's own error message doesn't leak
    //    the secret or the submitted token ──
    check(
      "[Path 2 secondary] captured logs show a token-verification-failed diagnostic line",
      /\[TEACHER_AUTH\] Token verification failed/.test(logs),
      'expected the real requireTeacherAuth diagnostic line to appear'
    );
    check(
      '[Path 2 secondary] jsonwebtoken error message does not contain the JWT secret',
      !logs.includes(TEACHER_JWT_SECRET),
      'covered above, re-asserted in this specific context for clarity'
    );
    check(
      '[Path 2 secondary] logs do not contain the raw invalid JWT that was submitted',
      !logs.includes(INVALID_JWT),
      `expected "${INVALID_JWT}" to be absent from logs`
    );

    // ── Distinguish "logs that a secret problem occurred" (expected, fine)
    //    from "logs the secret value" (the defect being checked for) ──
    check(
      '[Path 3] expected Yoco diagnostic line (reason=invalid_signature) still appears',
      /\[YOCO-WEBHOOK\] reason=invalid_signature/.test(logs),
      'expected the real verifyYocoWebhook rejection diagnostic to appear'
    );
  });

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${passed}/${total} assertions passed`);
  console.log(
    '\nNOTE: this proves the three audited paths (admin-secret rejection,\n' +
    'invalid-JWT rejection, invalid Yoco signature rejection) do not emit\n' +
    'the six deliberately unique, real, per-run secret values in captured\n' +
    'stdout/stderr under these specific failure conditions. It does not\n' +
    'prove that no secret can ever be logged under any condition anywhere\n' +
    'in the codebase.'
  );
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
