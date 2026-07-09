# SA Teacher Assistant — Launch Playbook

## First 50 Paying Teachers (R0–R2,000 Budget)

### Phase 1: First 10 (Week 1–2)

**Warm network — zero cost**

1. **Your existing contacts first.** Message 5–10 teachers you already know personally. Frame it as: "I built something for SA teachers, you'd be helping me test it." Free trial for 30 days for anyone who gives you feedback. One honest conversation beats 100 cold DMs.

2. **Facebook Groups** (free, high intent):
   - "South African Teachers" (100k+ members)
   - "CAPS Resources for Teachers"
   - "Grade [X] Teachers SA"
   - Post authentically: show a real worksheet you generated. Not an ad — a demonstration. "I made this in 8 seconds, is this useful?"

3. **WhatsApp Teacher Groups** — every school has them. Ask one teacher contact to share your number in their school's staff group. One introduction into a group of 40 teachers is worth 40 cold outreach messages.

**Script for first outreach (WhatsApp DM):**
> "Hey [name], I built a WhatsApp bot that generates CAPS-aligned worksheets, tests, and lesson plans in seconds. Free to try. Would you test it and tell me if it saves you time? Just WhatsApp [number]."

No pitch. No price. Ask for a test, not a sale.

### Phase 2: 10 → 50 (Month 1–2)

**Referral engine — R0 cost**

- Offer 1 free month Pro to any teacher who refers 3 paying teachers
- Build a simple "refer a friend" flow: when teacher types REFER, send them a personalized referral message they can forward
- Teachers trust teachers. One happy Grade 7 Maths teacher knows 8 others.

**Content seeding (R0–R500)**
- Create 3-4 sample PDFs (real worksheet, test, lesson plan) and post in Facebook groups with a screenshot showing how fast they were generated
- Pin a short video of the WhatsApp conversation (screen recording, 60 seconds) to your Facebook profile
- Post in every teacher Facebook group once per week — always lead with the output, not the price

**School rep model (R0)**
- Identify 1 teacher at 5 different schools who loves the product
- Make them a "School Rep" — they get 3 months free Pro in exchange for introducing it to colleagues
- This gets you distribution into staff rooms, not just social media

**Paid boost (R500–R1,500 if needed)**
- Boost one high-performing Facebook post to South African teachers (Facebook audience targeting: occupation = teacher, location = South Africa)
- R500 can reach 5,000–10,000 teachers on Facebook

### Conversion Approach

- Lead with free tier (10 generations). Let the product sell itself.
- After 3rd generation: soft nudge. "2 generations left — reply PRO to go unlimited for R99/month."
- After 5th generation: stronger nudge with social proof. "47 teachers upgraded to Pro this month."
- At limit: clear upgrade message with Yoco link. No pressure, but clear value.
- Target: 20% of active free users convert to Pro within 30 days.

### Retention

- Segment teachers who haven't used it in 7 days (query usage_events) and send a gentle re-engagement message
- Monthly: "New month, new 10 free generations! What are you teaching this term?"
- Term start (SA school terms): highest-intent moments — teachers need fresh material

---

## Execution Roadmap

### THIS WEEK (Days 1–7)
| Task | Effort | Business Impact |
|------|--------|-----------------|
| Deploy to Render/Railway | 2h | Launch blocker |
| Set up Meta WhatsApp Cloud API | 3h | Launch blocker |
| Configure Yoco (test → live keys) | 2h | Revenue blocker |
| Set all env vars in production | 1h | Launch blocker |
| Manual test all 4 content types | 2h | Quality assurance |
| Test full Yoco payment flow (use Yoco test card) | 1h | Revenue assurance |
| Send to first 5 teacher contacts | 1h | First users |

### NEXT WEEK (Days 8–14)
| Task | Effort | Revenue Impact |
|------|--------|----------------|
| Post in 5 Facebook teacher groups | 3h | First 20 signups |
| Share in 3 WhatsApp teacher groups | 1h | First 10 signups |
| Collect feedback from first testers | 2h | Retention data |
| Fix top 3 bugs from feedback | 4h | Retention |
| Set up school rep program (3 schools) | 2h | First conversions |

### THIS MONTH
| Task | Effort | Revenue Impact |
|------|--------|----------------|
| Referral flow (REFER command) | 4h | Organic growth |
| Re-engagement messages for inactive users | 3h | Retention |
| Facebook ad (R500 boost) | 1h setup | 10–30 new signups |
| Payment confirmation WhatsApp message | 3h | Pro UX |
| Admin dashboard (usage stats, revenue) | 6h | Visibility |
| Error monitoring (Sentry or simple logging) | 2h | Reliability |

### LATER (Month 2+)
| Task | Effort | Revenue Impact |
|------|--------|----------------|
| Annual plan (R799/year = 2 months free) | 4h | Revenue uplift |
| Afrikaans language support | 8h | Market expansion |
| Image-based question generation | 12h | Differentiation |
| School/institution billing | 10h | B2B revenue |
| Migrate from SQLite to PostgreSQL | 8h | Scale |

---

## Final Scorecard

### Launch Readiness: 8/10
The codebase is production-ready. Webhook security, rate limiting, error handling, deduplication, and DB migrations are all implemented. Main gap: untested Yoco live integration.

### Revenue Readiness: 8/10
Full Yoco payment flow is implemented. Free/Pro tiers with clear upgrade prompts. One thing missing: after payment confirmation, a WhatsApp notification to the teacher (blocked by one-way phone hash — solvable by storing the raw number encrypted, or by having teachers send UPGRADE after payment as a workaround).

### Teacher Adoption Score: 7/10
Onboarding is conversational and friendly. Product solves a real daily pain. WhatsApp reduces friction to near zero. Main adoption risk: teachers need to hear about it. That's the distribution problem, not a product problem.

### Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Meta WhatsApp API rate limits | Low | High | Chunking + 500ms delay already in place |
| Yoco webhook delivery failure | Medium | High | Log all ITN events; manual override capability |
| AI hallucinations in content | Medium | Medium | System prompt enforces CAPS; teachers review before distributing |
| SQLite bottleneck | Low (< 1000 users) | Low | WAL mode enables concurrent reads; migrate to Postgres at 500+ active users |
| POPIA compliance | Low | High | Phone numbers are HMAC-hashed; not reversible |

### Estimated Timeline to First Paying Customer
**3–7 days** after launch (from warm network contacts)

### Estimated Timeline to 50 Paying Teachers
**6–10 weeks** with consistent community posting and referral program

### Estimated Monthly Costs at 50 Pro Users
| Item | Cost |
|------|------|
| Render/Railway hosting | R0–R180/month |
| Anthropic API (est. 500 Sonnet + 2000 Haiku calls) | ~R350/month |
| Meta WhatsApp Cloud API | Free (first 1000 conversations/month) |
| Yoco transaction fees | 2.95% per transaction (Yoco standard rate) |
| **Total at 50 Pro users** | ~R600–700/month |

### Estimated Monthly Revenue at 50 Pro Users
- 50 × R99 = **R4,950/month gross**
- After Yoco fees (~3%): **~R4,700/month net**
- After API + hosting costs: **~R4,000/month profit**

### Path to R20,000/month
~200 Pro users. At a 15% free-to-Pro conversion rate, you need ~1,300 active free users.
South Africa has 400,000+ teachers. This is a numbers game won through community distribution.
