# SA Teacher — Teacher Success Engine
## WhatsApp Paper Prototype: MY GROWTH, Classroom Visit Prep, Reflect

*No code. These are the actual message-by-message scripts, written to be read aloud or run past real teachers before a single line of backend work happens. Where a message depends on the teacher's own data, it's written as a realistic filled-in example, not a placeholder — the point of a paper prototype is to feel real, not schematic. Branches are marked clearly. Tone target throughout: an assistant reporting back what it noticed, never a system checking whether the teacher complied.*

---

## Script 1 — MY GROWTH

**Entry point A: teacher types it directly**

> **Teacher:** MY GROWTH

**Entry point B: organic nudge, riding on an existing message (no extra message sent)**

> **SA Teacher:** Saved ✅ — Grade 7A Fractions Worksheet.
> You're building a solid record this term — 4 planning items, 2 assessments. Reply MY GROWTH anytime to see the full picture.

Both lead to the same reply:

> **SA Teacher:**
> Here's where Term 2 stands for you, Ms. Dlamini:
>
> 📘 Planning — strong (6 items)
> 📝 Assessment — strong (3 items)
> 🗒️ Moderation — 1 pack this term
> 📊 Curriculum coverage — Mathematics is 2 topics behind pace
> 🤝 Learner support — 1 active plan (Grade 7A, fractions)
> ✍️ Reflection — none yet this term
> 🎯 Growth Plan — not started
>
> Reply with a number to look closer, or just keep going — this updates itself as you work.
> 1. Curriculum coverage gap
> 2. Start a reflection
> 3. Growth Plan

*Design note: no item on this list is phrased as a shortfall the teacher has to explain. "Mathematics is 2 topics behind pace" is a fact, not a flag. There is no red/amber/green scoring anywhere in this message — deliberately, since a score is the fastest way to make this feel like it's grading the teacher rather than reporting to them.*

**Branch 1 — teacher replies "1" (curriculum coverage gap)**

> **SA Teacher:**
> Grade 7A Mathematics, Term 2: you've covered Fractions and Decimals against the ATP. Ratio & Proportion and Data Handling are still open — about 2 weeks behind where the ATP would put you today.
>
> This isn't unusual mid-term. Want me to draft a short catch-up plan, or just note it and move on?
>
> 1. Draft a catch-up plan
> 2. Just noted, thanks

**Branch 1a — "1" (draft a catch-up plan)**
Hands off into the existing curriculum-query/catch-up-plan flow (already built — no new content needed here, this is just the entry point).

**Branch 1b — "2" (just noted)**

> **SA Teacher:** Got it. It'll stay on your radar next time you check MY GROWTH.

**Branch 2 — teacher replies "2" (start a reflection)**
Hands off to Script 3 (Reflect), starting at its first question.

**Branch 3 — teacher replies "3" (Growth Plan)**

> **SA Teacher:**
> You don't have a reflection yet this term — a Growth Plan usually lands better once you've had a chance to think through what's actually working. Want to do a quick reflection first, or go straight to a Growth Plan anyway?
>
> 1. Quick reflection first
> 2. Straight to Growth Plan

*Design note: this branch is the clearest test of "assistant vs. judge." It would be easy to write this as "You must reflect before creating a Growth Plan" — a compliance gate. Instead it's a suggestion with an escape hatch. If a teacher who tests this finds "1. Quick reflection first / 2. Straight to Growth Plan" patronising rather than helpful, that's exactly the kind of signal this prototype exists to catch.*

---

## Script 2 — Classroom Visit Prep

**Entry point**

> **Teacher:** VISIT PREP

**Class selection (skipped automatically if the teacher has only one class)**

> **SA Teacher:**
> Which class?
> 1. Grade 7A Mathematics
> 2. Grade 9C Mathematics

> **Teacher:** 1

**Generation**

> **SA Teacher:** One moment — pulling together what's been happening in Grade 7A.

*(pause — this is where the AI generation call happens)*

> **SA Teacher:**
> **Grade 7A Mathematics — prep notes**
>
> **What you've taught recently:** Fractions (Lesson Plan, 3 Oct) and Decimals (Lesson Plan, 10 Oct), both CAPS-aligned to Term 2's ATP.
>
> **Where the class stands:** On pace for Fractions and Decimals. Ratio & Proportion hasn't started yet — worth mentioning if it comes up, since it's the next ATP topic, not a gap in what's already been covered.
>
> **Active support work:** You have an intervention plan running for 4 learners struggling with equivalent fractions, started 2 weeks ago. Worth having on hand — it shows you've already identified and are acting on a specific need in this class.
>
> **If asked what's next:** Ratio & Proportion, starting the week after this one, per your ATP.
>
> Want this as a PDF to keep on hand? Reply YES or NO.

**Branch — "YES"**

> **SA Teacher:** [PDF attached: Grade 7A Visit Prep — 24 Oct 2026]
> That's yours to keep — no need to do anything else with it unless you want to.

**Branch — "NO"**

> **SA Teacher:** No problem — this conversation will still be here if you want to scroll back to it.

*Design note: the entire brief is built from things the teacher already did — nothing here is invented, and nothing asks the teacher to do anything before the visit. There's no checklist, no "make sure you have X ready," no implication that the teacher is under-prepared. If this reads to a real teacher as "the app doing my homework for the visit" rather than "the app is reminding me what I already did," it's succeeding. If it reads as one more thing to review and manage before the visit, it's failing — worth watching for specifically, since that's the exact failure mode named going in.*

---

## Script 3 — Reflect

**Entry point**

> **Teacher:** REFLECT

**Guided questions — three short turns, not a form**

> **SA Teacher:** How's this term been going for you, honestly? No need to write much — a sentence or two is plenty.

> **Teacher:** Exhausting tbh. Grade 9C has been a lot. But I think the fractions intervention for 7A is actually working.

> **SA Teacher:** That's worth holding onto — what made the 7A intervention feel like it was working?

> **Teacher:** I split them into two smaller groups instead of trying to catch everyone up at once. Slower but it stuck.

> **SA Teacher:** Good to know. Last one — anything you'd do differently next term, for either class?

> **Teacher:** Probably start the small-group thing earlier instead of waiting until they were already behind.

**Generation**

> **SA Teacher:** Give me a moment to put this together.

*(pause)*

> **SA Teacher:**
> Here's a draft — edit anything that doesn't sound like you, or just say APPROVE if it's good as is:
>
> *"Term 2 was demanding, particularly with Grade 9C. The clearest win was the fractions intervention with Grade 7A: splitting the group in two rather than addressing the whole class at once took longer but produced results that held. Going into Term 3, the plan is to introduce small-group support earlier, before learners fall behind, rather than after."*
>
> Reply APPROVE to save this, or just tell me what to change.

**Branch — "APPROVE"**

> **SA Teacher:** Saved. This is yours — it'll show up in MY GROWTH and any portfolio you build from this term.

**Branch — teacher sends an edit instead, e.g. "take out the bit about 9C being demanding, keep the rest"**

> **SA Teacher:**
> *"Term 2's clearest win was the fractions intervention with Grade 7A: splitting the group in two rather than addressing the whole class at once took longer but produced results that held. Going into Term 3, the plan is to introduce small-group support earlier, before learners fall behind, rather than after."*
>
> Better?

> **Teacher:** yeah good

> **SA Teacher:** Saved.

*Design note: the draft is built entirely from the teacher's own three answers — no invented detail, no generic teaching-reflection filler. If a real teacher reads the draft and says "that's not what I meant" or "that sounds like a corporate version of what I said," that's the single most important thing this prototype could surface, because it means the reflection-drafting prompt needs real rework before any code gets written around it.*

---

## What to Listen For When Running These With Real Teachers

Matching the three risks already named going in:

1. **MY GROWTH** — does the category list feel like useful information, or like a report card? Watch specifically for reactions to "Mathematics is 2 topics behind pace" — that's the line most likely to land wrong.
2. **Classroom Visit Prep** — does it feel like the app remembering what they did, or like the app checking whether they did enough? Watch for any teacher who asks "wait, is this being sent to my HOD?" — that question would mean the framing failed, since nothing here is shared with anyone.
3. **Reflect** — does the AI-drafted paragraph sound like something they'd actually write, or like something written about them? This is the branch most likely to need real iteration — three short answers turning into a polished paragraph is the biggest inferential leap in any of these three scripts.

A fourth thing worth watching that wasn't on the original list: **whether the numbered-menu format itself feels natural in WhatsApp**, versus feeling like a phone-tree. All three scripts lean on it for branching. If it feels stiff, the fix is probably lighter (free-text replies parsed for intent, matching how the rest of the app already handles the assessment session flow's bulk-paste and roster commands) rather than a redesign of what these flows do.

---

*No code, no backend behavior implied beyond what's already built (Script 2's coverage/intervention data, Script 1's category counts) or already scoped in the Phase 3 spec (evidence tagging, reflection storage). Ready to read aloud or hand to a small group of teachers as-is.*
