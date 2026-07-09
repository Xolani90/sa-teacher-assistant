# Deployment Guide — SA Teacher Assistant v2.0

## Platform: Render.com (recommended)

Costs at launch: ~R0–R180/month (Web Service) + R90/month (Persistent Disk)

---

## Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial MVP"
git remote add origin https://github.com/YOUR_USERNAME/teacher-assistant.git
git push -u origin main
```

---

## Step 2 — Create Web Service on Render

1. render.com → **New → Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Node Version**: 18 or 20

---

## Step 3 — Mount a Persistent Disk ⚠️ REQUIRED

> SQLite data is wiped on every deploy if stored inside the container.
> This step is **required** before onboarding any paying teacher.

1. Render Dashboard → your service → **Disks** tab
2. **Add Disk**:
   - Name: `teacher-assistant-db`
   - Mount Path: `/var/data`
   - Size: 1 GB (sufficient for thousands of teachers)
   - Cost: ~$5 USD / R90 per month
3. Set the `DB_PATH` environment variable (see Step 4).

---

## Step 4 — Set Environment Variables

Go to Render Dashboard → your service → **Environment** tab.
Add every variable from the table below.

| Variable | Required | Description |
|---|---|---|
| `WHATSAPP_TOKEN` | ✅ | Meta WhatsApp access token |
| `WHATSAPP_PHONE_NUMBER_ID` | ✅ | Meta phone number ID |
| `VERIFY_TOKEN` | ✅ | Any string — must match Meta dashboard |
| `WEBHOOK_SECRET` | ✅ | Meta App Secret (from Meta Developers → Settings → Basic) |
| `ANTHROPIC_API_KEY` | ✅ | From console.anthropic.com |
| `PII_SECRET` | ✅ | 32-byte random hex — generate below |
| `APP_URL` | ✅ | `https://your-app-name.onrender.com` |
| `YOCO_SECRET_KEY` | ✅ | From portal.yoco.com → Developers → API Keys |
| `YOCO_WEBHOOK_SECRET` | ✅ | From portal.yoco.com → Developers → Webhooks |
| `DB_PATH` | ✅ | `/var/data/teacher_assistant.db` |
| `PORT` | optional | Default: 3000 |
| `FREE_LIMIT` | optional | Default: 10 |
| `PRO_PRICE_ZAR` | optional | Default: 99 |
| `SENTRY_DSN` | optional | From sentry.io — enables error monitoring |

Generate `PII_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 5 — Configure Yoco Payments

1. Log in to **portal.yoco.com**
2. Go to **Developers → API Keys**
   - Copy your **Secret Key** (`sk_live_...`) → set as `YOCO_SECRET_KEY`
   - Use test key (`sk_test_...`) for staging
3. Go to **Developers → Webhooks → Add Endpoint**
   - **URL**: `https://your-app-name.onrender.com/payment/webhook`
   - **Events**: select `payment.succeeded`
   - Copy the **Webhook Secret** → set as `YOCO_WEBHOOK_SECRET`
4. Verify the webhook fires by making a test payment.

---

## Step 6 — Configure Meta WhatsApp

1. developers.facebook.com → Your App → **WhatsApp → Configuration**
2. **Webhook URL**: `https://your-app-name.onrender.com/webhook`
3. **Verify Token**: same value as `VERIFY_TOKEN` env var
4. **Subscribe to**: `messages`

---

## Step 7 — Verify Launch

```bash
# Health check
curl https://your-app-name.onrender.com/
# Expected: {"status":"ok","service":"SA Teacher Assistant","version":"2.0.0",...}

# Test WhatsApp webhook verification (Meta sends this during setup)
# Render logs should show: [WEBHOOK] Meta verification successful

# Test Yoco webhook (use Yoco dashboard test event)
# Render logs should show: [YOCO-WEBHOOK] Teacher ...XXXXXXXX upgraded to Pro ✓
```

---

## Database

- Default path (development): `./data/teacher_assistant.db`
- Production (Render persistent disk): `/var/data/teacher_assistant.db`
- Schema migrations run automatically on every startup — safe to re-deploy.
- Backup: Render persistent disks have automatic daily snapshots.

---

## Error Monitoring (optional but recommended)

1. Sign up at **sentry.io** (free tier is sufficient for < 5000 events/month)
2. Create a new **Node.js** project
3. Copy the DSN → set as `SENTRY_DSN` environment variable
4. All unhandled exceptions, payment failures, and AI failures are automatically captured.

---

## Environment Variable Checklist Before First Deploy

- [ ] `DB_PATH=/var/data/teacher_assistant.db` (after mounting disk)
- [ ] `YOCO_SECRET_KEY` — live key, not test
- [ ] `YOCO_WEBHOOK_SECRET` — from portal.yoco.com
- [ ] `PII_SECRET` — freshly generated, 32 hex bytes
- [ ] `APP_URL` — your actual Render URL (no trailing slash)
- [ ] `WHATSAPP_TOKEN` — valid, not expired
- [ ] `WEBHOOK_SECRET` — Meta App Secret
