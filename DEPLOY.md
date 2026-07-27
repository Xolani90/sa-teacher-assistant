# SA Teacher Assistant — Deployment Guide

## Pre-deploy checklist

- [ ] All env vars set in Render dashboard (see below)
- [ ] Smoke test passes (11/11)
- [ ] End-to-end PDF round-trip confirmed on live server
- [ ] WhatsApp webhook URL updated in Meta dashboard

---

## Required environment variables

| Variable | Where to get it |
|---|---|
| `WHATSAPP_TOKEN` | Meta for Developers → your app → WhatsApp → API Setup |
| `WHATSAPP_PHONE_NUMBER_ID` | Same page as above |
| `VERIFY_TOKEN` | Any string you choose — must match what you set in Meta webhook config |
| `WEBHOOK_SECRET` | Any strong random string — used to verify Meta webhook signatures |
| `PII_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `ADMIN_SECRET` | Any strong random string — used to authenticate admin endpoints |
| `TEACHER_JWT_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — signs/verifies teacher JWTs for `/api/*` |
| `APP_URL` | Your Render URL, e.g. `https://sa-teacher-assistant.onrender.com` |
| `DB_PATH` | `/var/data/teacher_assistant.db` |
| `YOCO_SECRET_KEY` | Yoco dashboard → Developers → API Keys |
| `YOCO_WEBHOOK_SECRET` | Yoco dashboard → Developers → Webhooks |

---

## Deployment steps

### 1. Create service on Render
Go to render.com → New Web Service → connect `Xolani90/sa-teacher-assistant`.
Render will detect `render.yaml` and pre-fill most settings.

### 2. Set env vars
In the Render dashboard → Environment tab, add every variable from the table above.
Never commit secrets to git.

### 3. Deploy
Push to `main` or trigger a manual deploy. Watch the logs for:
```
[ENV] ✓ All required environment variables present
[DB] Connected to SQLite at /var/data/teacher_assistant.db
[SERVER] ✓ SA Teacher Assistant running on port 3000
```

### 4. Run smoke test
```bash
APP_URL=https://sa-teacher-assistant.onrender.com \
ADMIN_SECRET=your-admin-secret \
VERIFY_TOKEN=your-verify-token \
node scripts/smoke-test.js
```
All 11 checks must pass before onboarding teachers.

### 5. Grant yourself Pro and test end-to-end
```bash
curl -X POST https://sa-teacher-assistant.onrender.com/admin/grant-pro \
  -H "Content-Type: application/json" \
  -H "Authorization: your-admin-secret" \
  -d '{"phone": "27XXXXXXXXX"}'
```
Then WhatsApp your bot number: `Annual teaching plan grade 8 mathematics`
You should receive a PDF link within 30 seconds. Open it and confirm content is visible.

### 6. Configure WhatsApp webhook in Meta
Webhook URL: `https://sa-teacher-assistant.onrender.com/webhook`
Verify token: your `VERIFY_TOKEN` value

---

## Post-launch monitoring

- **Render logs** — watch for `[ERROR]` and `[PDF]` lines
- **UptimeRobot** — ping `GET /` every 5 minutes to prevent Render free-tier spin-down
- **Pro grants** — use the `/admin/grant-pro` endpoint; phone number can include or omit the `+` prefix

---

## Known limitations (free tier)

- Render's free tier spins down after 15 minutes of inactivity. PDF links (valid 2 hours) may be dead if the instance has spun down and the request times out. Upgrade to a paid instance or switch to sending PDFs as WhatsApp document attachments to eliminate this risk.
- SQLite on `/var/data` persists across deploys but not across service deletions. Back up the database before deleting the service.
