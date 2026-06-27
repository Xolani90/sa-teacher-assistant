# WhatsApp AI Teacher Assistant (CAPS-Aligned)

A WhatsApp bot that generates CAPS-aligned classroom materials for South African teachers instantly.

Send a WhatsApp message → receive a lesson plan, worksheet, test, or explanation within 10 seconds.

---

## File structure

```
teacher-assistant/
├── server.js                    # Express server entry point
├── routes/
│   └── webhook.js               # GET (verify) + POST (messages) endpoints
├── services/
│   ├── aiService.js             # Claude / OpenAI API wrapper
│   ├── promptService.js         # Routes to correct prompt template
│   └── whatsappService.js       # WhatsApp Cloud API sender
├── utils/
│   ├── intentParser.js          # Keyword-based intent + entity extraction
│   ├── chunker.js               # Splits long messages for WhatsApp limit
│   └── usageTracker.js          # Per-number free tier usage (JSON file)
├── prompts/
│   ├── lessonPlan.js            # CAPS lesson plan prompt
│   ├── worksheet.js             # CAPS worksheet prompt
│   ├── test.js                  # CAPS test + memorandum prompt
│   └── explanation.js           # Learner-friendly explanation prompt
├── tests/
│   └── test.js                  # Test suite (no external framework)
├── data/                        # Auto-created — usage.json stored here
├── .env.example                 # Environment variable template
├── .gitignore
├── package.json
└── README.md
```

---

## Run locally — step by step

**Prerequisites:** Node.js 18+, npm, ngrok (for webhook testing)

```bash
# 1. Clone or copy the project
cd teacher-assistant

# 2. Install dependencies
npm install

# 3. Copy .env.example and fill in values
cp .env.example .env
# Edit .env — add your WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, ANTHROPIC_API_KEY

# 4. Run tests to verify everything works
npm test

# 5. Start the server
npm run dev

# 6. In a separate terminal, expose localhost with ngrok
npx ngrok http 3000
# Copy the https URL — you'll need it for Meta webhook configuration
```

---

## Meta WhatsApp Cloud API setup

### Step 1 — Create Meta Developer App
1. Go to https://developers.facebook.com
2. Click **My Apps** → **Create App**
3. Select **Business** as app type
4. Name your app (e.g. "SA Teacher Assistant")
5. Click **Create App**

### Step 2 — Add WhatsApp Product
1. In your app dashboard, scroll to **Add Products**
2. Find **WhatsApp** → click **Set Up**
3. Accept the terms

### Step 3 — Get your credentials
1. Go to **WhatsApp** → **API Setup**
2. Copy the **Temporary Access Token** → paste as `WHATSAPP_TOKEN` in `.env`
3. Copy the **Phone Number ID** (below the test phone number) → paste as `WHATSAPP_PHONE_NUMBER_ID`
4. Note your **Test Phone Number** — you will send FROM this number

### Step 4 — Add yourself as test recipient
1. Under "To" in the API Setup page, click **Manage phone number list**
2. Add your personal WhatsApp number (with country code, e.g. +27821234567)
3. You will receive a WhatsApp verification code — enter it

### Step 5 — Configure webhook
1. Go to **WhatsApp** → **Configuration** → **Webhook** → **Edit**
2. **Callback URL:** `https://YOUR-NGROK-OR-RENDER-URL/webhook`
3. **Verify token:** must match `VERIFY_TOKEN` in your `.env` exactly
4. Click **Verify and Save**
5. Under **Webhook fields**, click **Manage** → enable **messages** → click **Done**

### Step 6 — Test locally
Send a message FROM your personal WhatsApp number TO the Meta test number shown in API Setup.

---

## Deploy to Render (free tier)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "initial: WhatsApp Teacher Assistant"
git remote add origin https://github.com/YOUR_USERNAME/teacher-assistant.git
git push -u origin main
```

### Step 2 — Create Render Web Service
1. Go to https://render.com → sign up free
2. Click **New** → **Web Service**
3. Connect your GitHub account → select your repo
4. Configure:
   - **Name:** teacher-assistant
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free

### Step 3 — Set environment variables on Render
In your Render service → **Environment** tab → add each variable:
```
WHATSAPP_TOKEN          = (your token)
WHATSAPP_PHONE_NUMBER_ID = (your phone number ID)
VERIFY_TOKEN            = teacher_assistant_verify_2024
ANTHROPIC_API_KEY       = (your Claude API key)
PORT                    = 3000
FREE_LIMIT              = 5
```

### Step 4 — Update webhook URL
After Render deploys (2–3 minutes), you get a URL like `https://teacher-assistant.onrender.com`.

Go back to Meta → WhatsApp → Configuration → update Webhook URL to:
```
https://teacher-assistant.onrender.com/webhook
```
Re-verify. Done.

### Note on Render free tier cold starts
Render free tier spins down after 15 minutes of inactivity. First message after inactivity = ~30 second delay.

**Fix (free):** Set up https://uptimerobot.com → New Monitor → HTTP → URL: `https://your-app.onrender.com/` → interval: 10 minutes. This keeps the service warm at no cost.

---

## 5-step test checklist

**Before running these, ensure:**
- Server is running (local with ngrok, or deployed on Render)
- Webhook is verified in Meta dashboard
- Your personal number is added as a test recipient
- You are sending TO the Meta test phone number

**Test 1 — Worksheet**
Send: `Grade 7 algebra worksheet`
Expected: A formatted worksheet with Section A (MCQ), Section B (short answer), Section C (problem solving), mark allocations totalling 20 marks.

**Test 2 — Explanation**
Send: `Explain photosynthesis Grade 8`
Expected: Explanation with "What is it?", analogy, step-by-step breakdown, worked example, key words sections. Life sciences CAPS terminology.

**Test 3 — Test + Memo**
Send: `Make a 20-mark test on fractions`
Expected: Two-part response — test paper with 4 questions across cognitive levels, followed by full memorandum with mark breakdown. Total = exactly 20 marks.

**Test 4 — Lesson plan**
Send: `Lesson plan Grade 9 English poetry`
Expected: Full lesson plan with Learning Objectives, CAPS Topic Link, Teaching Steps, Learner Activity, Assessment, Homework, Differentiation sections. Duration: 60 min.

**Test 5 — Free tier limit**
Send 6 messages from the same number.
Expected: First 5 are processed normally. 6th receives the upgrade message about the R99/month Pro plan.

---

## Supported commands

| Message | Output |
|---|---|
| Grade [N] [subject] worksheet | CAPS worksheet with memo |
| Lesson plan Grade [N] [topic] | Full 60-min CAPS lesson plan |
| [N]-mark test on [topic] | Test paper + memorandum |
| Explain [topic] Grade [N] | Learner-friendly explanation |

Subjects auto-detected: mathematics, physical sciences, life sciences, english, history, geography, accounting, business studies, economics.

---

## Upgrading a user to Pro

To manually mark a user as Pro (after payment), run:

```bash
node -e "
const { markUserAsPro } = require('./utils/usageTracker');
markUserAsPro('27821234567'); // Use full number without +
console.log('Done');
"
```

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `WHATSAPP_TOKEN` | Yes | Meta temporary or permanent access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | From Meta API Setup page |
| `VERIFY_TOKEN` | Yes | Your chosen string — must match Meta dashboard |
| `ANTHROPIC_API_KEY` | One of these | Claude API key |
| `OPENAI_API_KEY` | One of these | OpenAI API key |
| `PORT` | No | Default: 3000 |
| `FREE_LIMIT` | No | Monthly free generations per user. Default: 5 |
