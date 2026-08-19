// Row 9 (Security) — "stack traces / raw DB errors never returned to the
// client" audit.
//
// This file deliberately combines two DIFFERENT kinds of evidence, and is
// written to keep that distinction explicit rather than blur it:
//
//   PART 1 (runtime): a real, unmocked HTTP request against a real route
//   forces malformed JSON through Express's actual body-parser, which
//   throws a genuine SyntaxError and reaches the real global error
//   handler at server.js's app.use((err, _req, res, _next) => {...}).
//   This proves the real error-handling MECHANISM is reachable and safe
//   for the case it actually exercises. Body-parser's SyntaxError carries
//   err.status = 400, and the global handler's own logic
//   (`statusCode < 500 ? err.message : 'Internal server error'`)
//   deliberately passes 4xx messages through — so this is 400-path
//   evidence only.
//
//   THIS DOES NOT PROVE THE 500 BRANCH. No route in this codebase
//   currently offers a way to force a genuine unhandled exception using
//   only real inputs (every DB-touching handler already wraps its own
//   try/catch and returns a fixed generic message before ever reaching
//   the global handler as a true 500). Forcing one would require either
//   modifying production code to inject a fault, or monkey-patching a
//   dependency — both explicitly out of scope per this row's evidence
//   rules.
//
//   PART 2 (static): a source-inspection audit of every res.status(500)
//   call site in server.js, routes/api.js, routes/auth.js,
//   utils/adminAuth.js, and utils/teacherAuth.js, plus the global error
//   handler itself, confirming each one returns a fixed literal string
//   and never interpolates err.message or err.stack. This reads the
//   actual production source text — it does not reimplement or simulate
//   the behavior.
//
// Known open item, explicitly NOT covered by either part: GET
// /admin/stats (server.js) is the one route handler with no try/catch at
// all. Its dependency (utils/aiCostMonitor.js's getStats()) reads only
// in-memory counters, not user-controlled input, so there is no known
// real way to force it to throw. This is left as an acknowledged,
// untested gap rather than silently treated as covered by Part 1 or 2.
//
// Honest evidence statement (do not overstate beyond this):
// Runtime evidence proves the real global error-handler path does not
// expose stack traces or DB-error signatures on malformed input (a real
// 400 case). Source-inspection evidence separately verifies that every
// currently-identified production 500-response path returns the fixed
// generic message and never returns err.message or err.stack. No genuine
// 500 was triggered end-to-end; that remains unproven for /admin/stats
// specifically.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const results = [];
const check = (name, cond, detail = '') => {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ' — ' + detail}`);
};

// ── PART 1: runtime malformed-JSON → real global error handler ────────────

const ADMIN_SECRET = 'test-admin-secret-for-error-handler-audit';
// Unique marker embedded in the malformed body. If any verbose error
// path ever echoed request content back to the client, this proves it —
// while a normal SyntaxError message (position/token info only) will
// never happen to contain it.
const MARKER = 'ROW9-MARKER-9f3a7c21';
const MALFORMED_BODY = `{"phone": "${MARKER}", this is not valid json`;

// Signatures that would indicate stack-trace or DB-internal leakage.
const STACK_SIGNATURES = ['    at ', '.js:', 'node_modules', 'Error:\n'];
const DB_SIGNATURES = ['SQLITE_', 'sqlite3', '.prepare(', 'better-sqlite3', 'UPDATE teachers', 'SELECT ', 'FROM teachers'];

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

function postMalformedJson(port) {
  return request(
    port,
    {
      path: '/admin/grant-pro',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(MALFORMED_BODY),
        'Authorization': ADMIN_SECRET,
      },
    },
    MALFORMED_BODY
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

async function runPart1() {
  const PORT = 38600 + Math.floor(Math.random() * 400);
  const DB_PATH = path.join(__dirname, `.error-handler-audit-${Date.now()}.db`);

  await withServer(PORT, DB_PATH, async () => {
    const res = await postMalformedJson(PORT);

    check(
      '[Part 1 runtime] malformed JSON reaches the global error handler and returns 400',
      res.status === 400,
      `got ${res.status}: ${res.body}`
    );

    check(
      '[Part 1 runtime] response body is present and JSON-parseable',
      (() => { try { JSON.parse(res.body); return true; } catch { return false; } })()
    );

    check(
      '[Part 1 runtime] response does not contain err.stack (no stack-frame signatures)',
      !STACK_SIGNATURES.some(sig => res.body.includes(sig)),
      `body: ${res.body}`
    );

    check(
      '[Part 1 runtime] response does not contain SQL/DB-internal signatures',
      !DB_SIGNATURES.some(sig => res.body.includes(sig)),
      `body: ${res.body}`
    );

    check(
      '[Part 1 runtime] response does not echo the injected request marker',
      !res.body.includes(MARKER),
      `body: ${res.body}`
    );
  });
}

// ── PART 2: static source audit of every 500-response path ────────────────

const AUDITED_FILES = [
  'server.js',
  'routes/api.js',
  'routes/auth.js',
  'utils/adminAuth.js',
  'utils/teacherAuth.js',
];

const ALLOWED_500_MESSAGES = ['Internal server error', 'Server misconfiguration'];

function auditStaticFile(relPath) {
  const fullPath = path.join(__dirname, '..', relPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, idx) => {
    if (!/res\.status\(500\)/.test(line)) return;
    const lineNo = idx + 1;

    // Look at this line and the next line (json({...}) sometimes wraps).
    const window = line + '\n' + (lines[idx + 1] || '');

    const usesAllowedLiteral = ALLOWED_500_MESSAGES.some(msg => window.includes(`'${msg}'`) || window.includes(`"${msg}"`));
    check(
      `[Part 2 static] ${relPath}:${lineNo} uses a fixed generic 500 message`,
      usesAllowedLiteral,
      `line: ${line.trim()}`
    );

    const leaksErrMessage = /err\.message|error\.message/.test(window) && !/console\.(error|warn|log)/.test(line);
    check(
      `[Part 2 static] ${relPath}:${lineNo} does not return err.message to the client`,
      !leaksErrMessage,
      `line: ${line.trim()}`
    );

    const leaksStack = /\.stack/.test(window);
    check(
      `[Part 2 static] ${relPath}:${lineNo} does not return err.stack to the client`,
      !leaksStack,
      `line: ${line.trim()}`
    );
  });
}

function auditGlobalHandler() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  // Isolate the app.use((err, ...) => {...}) global error handler block.
  const match = src.match(/app\.use\(\(err, _req, res, _next\) => \{[\s\S]*?\n\}\);/);
  check('[Part 2 static] global error handler block found in server.js', !!match);
  if (!match) return;

  const block = match[0];
  check(
    "[Part 2 static] global handler's 500 branch substitutes a generic message, not err.message",
    /statusCode < 500 \? err\.message : 'Internal server error'/.test(block),
    block
  );
  check(
    '[Part 2 static] global handler never sends err.stack in the response body',
    !/res\.(status\([^)]*\)\.)?json\([^)]*\.stack/.test(block),
    block
  );
}

function runPart2() {
  AUDITED_FILES.forEach(auditStaticFile);
  auditGlobalHandler();
}

async function main() {
  if (!process.env.RUN_SMOKE_TESTS) {
    console.log('SKIPPED: row9-error-handler-audit.test.js (set RUN_SMOKE_TESTS=1 to run — spawns real server for Part 1)');
    process.exit(0);
  }

  await runPart1();
  runPart2();

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${passed}/${total} assertions passed`);
  console.log(
    '\nNOTE: Part 1 proves the real global error handler is safe on the 400\n' +
    '(malformed-JSON) path. It does NOT prove the 500 branch was exercised\n' +
    'end-to-end. Part 2 separately proves, via source inspection of production\n' +
    'code, that every currently-identified 500-response path (including\n' +
    'server.js\'s global handler) returns a fixed generic message and never\n' +
    'err.message/err.stack. GET /admin/stats has no try/catch and no known\n' +
    'way to force it to throw with real inputs — left as an acknowledged,\n' +
    'untested gap, not claimed as covered.'
  );
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
