// Integration smoke test for POST /payment/webhook.
//
// Deliberately thin — the six rejection branches are already proven fast
// and in isolation by tests/yocoWebhookVerifier.test.js. This test exists
// only to prove the wiring: a real HTTP request, with a real signature,
// hitting the real Express route, reaches the real handler.
//
// Spawns server.js as a child process on a throwaway port with an isolated
// throwaway SQLite DB, so it never touches the real data/teacher_assistant.db.

const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = 34567 + Math.floor(Math.random() * 1000);
const SECRET = 'whsec_' + Buffer.from('smoke-test-signing-secret-bytes!').toString('base64');
const TMP_DB = path.join(__dirname, `.smoke-test-${Date.now()}.db`);

function sign({ id, timestamp, body }) {
  const signedContent = `${id}.${timestamp}.${body}`;
  const secretBytes = Buffer.from(SECRET.slice('whsec_'.length), 'base64');
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

function postWebhook(body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: '/payment/webhook',
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

function waitForLog(predicate, timeoutMs = 3000) {
  const start = Date.now();
  return new Promise(resolve => {
    (function check() {
      if (predicate()) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(check, 25);
    })();
  });
}

function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      const req = http.get({ host: 'localhost', port: PORT, path: '/' }, res => {
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
    console.log('SKIPPED: payment-webhook-smoke.test.js (set RUN_SMOKE_TESTS=1 to run — spawns real server + better-sqlite3)');
    process.exit(0);
  }

  const results = [];
  const check = (name, cond, detail = '') => {
    results.push(cond);
    console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ' — ' + detail}`);
  };

  let logs = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: TMP_DB,
      YOCO_WEBHOOK_SECRET: SECRET,
      PII_SECRET: process.env.PII_SECRET || 'a'.repeat(64),
      NODE_ENV: 'test',
    },
  });
  child.stdout.on('data', d => (logs += d.toString()));
  child.stderr.on('data', d => (logs += d.toString()));

  try {
    await waitForServer();

    // Valid, correctly-signed webhook → expect 200 and evidence the handler ran.
    const id = 'evt_smoke_1';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const eventBody = JSON.stringify({
      type: 'payment.succeeded',
      payload: { id: 'p_smoke_1', metadata: { phone: '+27000000000' } },
    });
    const signature = sign({ id, timestamp, body: eventBody });

    const res = await postWebhook(eventBody, {
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    });

    check('valid webhook POST returns 200 (acknowledge-first design)', res.status === 200, `got ${res.status}`);

    // Wait until the async post-response handler has actually run and logged
    // something for this event, rather than sleeping a fixed guess.
    await waitForLog(() => logs.includes(id));

    const reachedHandler = !logs.includes('reason=invalid_signature')
      && !logs.includes('reason=missing_headers')
      && !logs.includes('reason=replay_attack')
      && !logs.includes('reason=malformed_secret')
      && !logs.includes('reason=missing_secret');
    check('valid signature did not hit a rejection branch', reachedHandler, logs.slice(-500));

    // Invalid signature → still 200 (acknowledge-first), but rejected downstream.
    const badRes = await postWebhook(eventBody, {
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': 'v1,' + Buffer.from('garbage').toString('base64'),
    });
    check('invalid signature still returns 200', badRes.status === 200, `got ${badRes.status}`);

    await waitForLog(() => logs.includes('reason=invalid_signature'));
    check('invalid signature was logged as rejected', logs.includes('reason=invalid_signature'));
  } finally {
    child.kill('SIGTERM');
    try { fs.unlinkSync(TMP_DB); } catch {}
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
