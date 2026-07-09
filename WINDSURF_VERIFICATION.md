# Local Verification Checklist — Run This Before Real-Money Testing

Give this whole file to Windsurf (or run it yourself) on your actual machine,
inside the v16 project folder. The point of this pass is to catch anything
that only shows up against the REAL `better-sqlite3` binary and a REAL
running server — things a sandboxed mock cannot see.

Do not skip steps. Each one targets a specific blind spot.

---

## 0. Setup

```bash
cd ta-mvp-fixed-v16
cp .env.example .env
```

Fill in `.env` with real values:
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `META_APP_SECRET` — from Meta dashboard
- `YOCO_SECRET_KEY`, `YOCO_WEBHOOK_SECRET` — use Yoco's **test/sandbox** keys for now, not live
- `PII_SECRET`, `PDF_SECRET`, `ADMIN_SECRET` — generate fresh with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `APP_URL=http://localhost:3000` for local testing
- `ANTHROPIC_API_KEY` — your real key, since this now powers intent classification

```bash
npm install
```

This is the first real signal: if `better-sqlite3` fails to compile here,
something is wrong with your local node-gyp/Python toolchain — fix that
before anything else, since the whole DB layer depends on it.

---

## 1. Run every test file — confirm the count

```bash
npm test
```

**Expect:** 4 test files run (test.js, test-atp.js, flows.test.js, payment.test.js),
all passing. This was fixed in v16 — previously `npm test` silently skipped
2 of the 4 test files, which is how a stub test (`payment.test.js`) sat unrun
for an unknown period. Confirm the output explicitly lists all 4 files running,
not just 2.

**If anything fails here**, it fails differently than it failed in my sandbox,
because this is the real SQLite binary, not a mock. Treat any failure here as
higher-signal than anything I told you, and investigate before moving on.

---

## 2. Start the real server, confirm DB initializes cleanly

```bash
npm run dev
```

**Expect to see**, in order:
```
[ENV] ✓ All required environment variables present
[DB] Connected to SQLite at ...
[DB] Migrations complete
[SERVER] ✓ SA Teacher Assistant running on port 3000
```

If migrations fail or hang here, that's a real schema bug my mock could
never have caught — my mock never ran a single real `CREATE TABLE` or
`ALTER TABLE` statement.

Leave this running for the remaining steps.

---

## 3. Hit the health and admin endpoints for real

In a second terminal:

```bash
curl http://localhost:3000/
```
Expect: `{"status":"ok",...}`

```bash
curl http://localhost:3000/admin/stats -H "Authorization: YOUR_ADMIN_SECRET"
```
Expect: JSON with `ai.total: 0` (or close to it) and `ceiling_reached: false`.
This endpoint is new in v16 — if it 404s or errors, something in server.js
didn't wire up correctly outside my sandbox.

---

## 4. Send a real message through the actual webhook route (no Meta yet)

This simulates what Meta would send, hitting your REAL running server with
a REAL database, REAL session store, and REAL AI classifier call (this one
actually calls Anthropic — make sure `ANTHROPIC_API_KEY` is real).

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$(node -e "
    const crypto = require('crypto');
    const body = JSON.stringify({entry:[{changes:[{value:{messages:[{from:'27821234567',id:'wamid.localtest1',type:'text',text:{body:'Grade 7 maths worksheet on fractions'}}]}}]}]});
    console.log(crypto.createHmac('sha256', process.env.META_APP_SECRET || 'placeholder').update(body).digest('hex'));
  ")" \
  -d '{"entry":[{"changes":[{"value":{"messages":[{"from":"27821234567","id":"wamid.localtest1","type":"text","text":{"body":"Grade 7 maths worksheet on fractions"}}]}}]}]}'
```

**Expect:** server logs show the message being classified and processed.
Since `WHATSAPP_TOKEN` likely isn't fully valid in this local test, the
actual WhatsApp send will probably fail at the network call — that's fine,
what you're checking is that classification, quota tracking, and prompt
generation all ran without crashing before that point.

**This is the single most valuable step in this whole checklist** — it's
the first time this code touches a *real* SQLite database with a *real*
AI classification call, both of which I could only mock.

---

## 5. Concurrent message stress test (race condition check)

This targets something I explicitly could not test — two messages from
different teachers hitting the quota/session system at the same instant.

```bash
node -e "
const http = require('http');
const crypto = require('crypto');
const secret = process.env.META_APP_SECRET || 'placeholder';

function send(phone, text, id) {
  const body = JSON.stringify({entry:[{changes:[{value:{messages:[{from:phone,id,type:'text',text:{body:text}}]}}]}]});
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  const req = http.request({hostname:'localhost',port:3000,path:'/webhook',method:'POST',
    headers:{'Content-Type':'application/json','X-Hub-Signature-256':sig,'Content-Length':Buffer.byteLength(body)}});
  req.write(body); req.end();
}

// 10 different teachers, simultaneously
for (let i = 0; i < 10; i++) {
  send('2782000' + String(i).padStart(4,'0'), 'Grade ' + (i%12+1) + ' worksheet on a topic', 'wamid.stress' + i);
}
console.log('Fired 10 concurrent requests — check server logs for crashes or unhandled errors');
"
```

**Expect:** no crashes, no `unhandledRejection` in server logs, server stays up.
Check `/admin/stats` again afterward — `ai.total` should have increased
sensibly, not by some wildly wrong number.

---

## 6. Yoco sandbox payment — see "Real Transaction Test" section below first,
then come back and confirm the local server logs show:
```
[YOCO] ✓ payment.succeeded — teacher ...XXXXXXXX upgraded to Pro
```

---

## 7. Report back

For each numbered step, note: pass / fail / unexpected output. Anything
that fails here is real signal — fix it before deploying to Render, since
this is closer to production reality than anything tested in a sandbox.
