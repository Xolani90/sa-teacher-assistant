# SA Teacher — Teacher Success Engine
## Phase 2: Complete Product Specification

*This is a product/architecture specification only. No production code is included. It builds directly on the approved Phase 1 audit (`SA_Teacher_QMS_Architecture_Audit.md`) and inherits its non-negotiable rule: every existing table, route, prompt, flow, and WhatsApp command stays exactly as it is today. "Classroom Visit Prep" is adopted as the resolved name for what was previously the naming-collision risk around "Observation" (Phase 1, §4.1).*

---

## 0. Product Framing

**Internal engineering name:** QMS integration layer (as scoped in Phase 1).
**Product name teachers see:** nothing QMS-flavoured at all. The capability is never presented as a compliance tool.

The Teacher Success Engine (TSE) is the umbrella the teacher actually experiences: an assistant that quietly keeps them organised, then hands them a ready-made, professional record whenever they need one — for a classroom visit, a moderation meeting, or their own end-of-term reflection. QMS, evidence linking, portfolios, Classroom Visit Prep, Growth Plans, Development Support Group (DSG) collaboration, and reflections are all *internal capabilities* of TSE, not separate products the teacher has to learn.

This has one direct architectural consequence carried through the rest of this spec: **there is no single "QMS" entry point.** Instead there's a small, consistently-named family of commands (§4) and — more importantly — proactive, contextual nudges that surface TSE value inside flows the teacher is already using (e.g. a one-line note after a lesson plan is saved: *"Saved. That's your 3rd planning record this term."*). The explicit commands exist for teachers who want to go looking; the nudges are what most teachers will actually encounter first.

---

## 1. Information Architecture

```
Teacher Success Engine (branding layer — teacher-facing)
│
├── Evidence Layer            (internal: qms_evidence_links + categories)
│     — invisible to the teacher; powers everything below
│
├── MY GROWTH                 (WhatsApp command + Dashboard page — the "home" of TSE)
│     ├── Status snapshot (per category, this term)
│     ├── Missing-evidence nudges
│     └── Entry points into the four capabilities below
│
├── Classroom Visit Prep      (WhatsApp flow + Dashboard section)
├── Reflections               (WhatsApp flow + Dashboard section)
├── Personal Growth Plan      (WhatsApp flow + Dashboard section)
├── Portfolio                 (Dashboard-primary; WhatsApp can trigger + receive PDF)
│
└── Development Support Group (DSG)   (Dashboard-primary; new multi-party surface)
      — the one part of TSE that isn't single-teacher-scoped (see §8)
```

Everything under "MY GROWTH" is additive to the existing app's information architecture (§1.2 of the audit): it sits alongside `WORKSPACE`, not inside it, and never intercepts an existing command.

---

## 2. User Journeys

### 2.1 First contact (organic discovery, no command typed)
A teacher generates a lesson plan, then a worksheet, then runs a Classroom Visit Prep-eligible assessment session over two weeks — normal usage, no TSE awareness. After a threshold of linked evidence accumulates (configurable; suggested: 3+ evidence-bearing actions in a rolling 14 days), the *next* SAVE confirmation or WORKSPACE summary includes one added line: *"You're building a solid record this term — 4 planning items, 2 assessments. Reply MY GROWTH anytime to see the full picture."* This is a nudge, not a new message — it rides on an existing send, costing nothing extra in WhatsApp message volume.

### 2.2 A teacher checks their standing before a scheduled visit
Teacher sends `MY GROWTH`. TSE responds with a deterministic (non-AI) per-category snapshot for the current term — e.g. Planning: strong, Assessment: strong, Moderation: 1 pack this term, Curriculum Coverage: 2 topics behind pace, Reflection: none yet, Growth Plan: not started. Each line is a menu option (numbered reply) into that capability. This is the "front door" journey and should work with zero AI calls — a deliberate design choice matching the app's existing pattern of instant, deterministic workspace summaries (`MY PROGRESS`, `WORKSPACE`).

### 2.3 Classroom Visit Prep
Trigger: `VISIT PREP` (typed ahead of a scheduled visit) or a proactive nudge if the teacher's `classes` table shows an upcoming visit date has been logged (see §6, `tse_visits`). TSE asks which class (0/1/2+ selector, same convention as every other class-scoped flow), then produces an AI-drafted prep brief: recent lesson plans for that class, current curriculum coverage standing, any open intervention plans, and a short "what a visitor is likely to ask about" note grounded only in the teacher's own real data — never invented content. Delivered as a WhatsApp message with an optional PDF attachment (same PDF-eligibility pattern as every other resource type).

### 2.4 End-of-term reflection
Trigger: `REFLECT`, or a term-boundary nudge (the app already knows SA term dates via `curriculumIntelligenceService.js`'s school calendar). TSE asks 2–3 short guided questions (what went well, what was hardest, what you'd change), then offers an AI-drafted reflection narrative stitched from those answers plus the term's actual evidence (e.g. "You closed the fractions gap you flagged in Term 2's intervention plan"). The teacher edits or approves before it's saved — reflections are never auto-published without teacher sign-off.

### 2.5 Growth Plan cycle
Trigger: `GROWTH PLAN`, typically after a reflection exists or after a Classroom Visit Prep/visit has happened. TSE proposes 1–3 draft goals grounded in real patterns (a subject with persistent coverage gaps, a recurring intervention theme, a teacher-stated reflection concern), the teacher selects/edits, and a plan with target areas, timeline, and a review date is saved. A future review-date nudge ("Your Growth Plan review is due — want to check progress?") closes the loop.

### 2.6 Portfolio build
Trigger: `PORTFOLIO` (WhatsApp) or the Dashboard's Portfolio page. Teacher picks a scope (a term, a class, or "everything"); TSE compiles every linked evidence item plus any reflections/growth plan into a single branded PDF via the existing `pdfService.js`, and records the snapshot. WhatsApp delivers the PDF directly; the Dashboard additionally lets the teacher browse and re-download past snapshots.

### 2.7 Development Support Group (DSG) collaboration — new territory
IQMS's actual evaluation model isn't self-assessment alone — a small Development Support Group (typically the teacher plus one or two peers/an HOD) conducts the appraisal together. Journey: a teacher (or HOD, if the school's account structure supports it — see §8) invites 1–2 colleagues into their DSG for a cycle. Those colleagues get **read-only, time-boxed, explicitly-scoped** access to that teacher's portfolio and Classroom Visit Prep notes, and can leave structured comments. This is the one journey that cannot be built on the existing single-teacher `phone_hash` scoping model as-is — flagged in detail in §8, not glossed over.

---

## 3. WhatsApp Interaction Flows

All new flows follow the audit's established convention exactly: a new `flows/tse<Name>Flow.js` per multi-turn conversation, dependency-injected, `SessionStore`-backed where multi-turn, registered into `core/messageProcessor.js`'s existing mid-flow routing list, with new `INTENT_TYPES` entries and new exact-match commands checked against the full existing command list (Phase 1 audit §4.2).

**New commands (checked against the existing list — no collisions):**

| Command | Type | Behaviour |
|---|---|---|
| `MY GROWTH` | Stateless, instant | Deterministic per-category status snapshot + numbered menu |
| `VISIT PREP` (or class-qualified, e.g. `VISIT PREP GRADE 7A`) | Multi-turn (class selector) → AI generation | Classroom Visit Prep brief |
| `REFLECT` | Multi-turn (guided questions) → AI generation | Reflection assistant |
| `GROWTH PLAN` | Multi-turn (goal review/edit) → AI generation | Growth Plan drafting |
| `PORTFOLIO` | Multi-turn (scope selector) → compilation, no AI | Portfolio PDF build |
| `DSG` | Multi-turn (invite/view) | DSG membership + shared-view management |

`CANCEL` behaves identically inside every new flow, exactly as it does today (audit §1.2). No new flow introduces its own cancel semantics.

**Sample conversation — Classroom Visit Prep:**

```
Teacher:  VISIT PREP
TSE:      Which class?
          1. Grade 7A Mathematics
          2. Grade 9C Mathematics
Teacher:  1
TSE:      [AI-drafted prep brief, grounded in that class's recent lesson
           plans, coverage standing, and open intervention plans]
          Want this as a PDF too? Reply YES or NO.
Teacher:  YES
TSE:      [PDF delivered]
```

This mirrors the existing `assessmentAnalysisFlow`/`interventionPlanFlow` shape (grade/class selection → generation → optional PDF) closely enough that it can reuse most of `core/generationPipeline.js`'s existing machinery rather than duplicating it.

---

## 4. Data Model / Database Schema

Building directly on the audit's §6 recommendation — additive only, no existing table touched. Presented here at column-level detail (not as executable DDL, per the "no production code yet" instruction).

### 4.1 `tse_evidence_categories` *(renamed from the audit's `qms_evidence_categories` to match TSE branding internally — table name only, not user-facing)*
Reference table. Fixed rows: Planning, Assessment, Moderation, Learner Support, Curriculum Coverage, Reflection, Growth Plan, Classroom Visit Prep.
- `id`, `key` (stable code, e.g. `planning`), `display_label`, `created_at`

### 4.2 `tse_evidence_links`
The core evidence-tagging table — never duplicates content, only points at it.
- `id`
- `phone_hash` (references `teachers`)
- `class_id` (nullable, references `classes`)
- `category_id` (references `tse_evidence_categories`)
- `source_table` (e.g. `saved_resources`, `reports`, `assessments`, `intervention_plans`, `curriculum_coverage`, `observation_assessments`)
- `source_id` (the row id in that table)
- `term`, `year` (denormalised for fast per-term aggregation — same pattern as `usage_events.month_key`)
- `created_at`

### 4.3 `tse_reflections`
- `id`, `phone_hash`, `class_id` (nullable), `term`, `year`
- `prompt_answers` (structured: what went well / hardest / would change — teacher's own words)
- `narrative` (AI-drafted or teacher-edited final text)
- `status` (`draft` | `approved`) — mirrors the teacher-must-approve rule in §2.4
- `created_at`, `updated_at`

### 4.4 `tse_growth_plans`
- `id`, `phone_hash`
- `target_areas` (structured list)
- `goals`, `timeline`, `review_date`
- `status` (`active` | `under_review` | `complete`)
- `linked_reflection_id` (nullable, references `tse_reflections` — a plan can trace back to the reflection that prompted it)
- `created_at`, `updated_at`

### 4.5 `tse_visits`
New: records a scheduled/completed classroom visit (distinct from the existing `observation_assessments`, which is Foundation Phase learner-developmental data — never conflated per audit §4.1).
- `id`, `phone_hash`, `class_id` (nullable)
- `scheduled_at` (nullable — supports both "log a past visit" and "schedule an upcoming one")
- `visitor_role` (free text: HOD, peer, subject head)
- `prep_brief_id` (nullable, references `saved_resources` — the generated prep brief, reusing the existing SAVE lifecycle rather than a new content store)
- `status` (`scheduled` | `completed` | `cancelled`)
- `created_at`, `updated_at`

### 4.6 `tse_portfolio_snapshots`
- `id`, `phone_hash`, `scope` (`term` | `class` | `all`), `scope_ref` (term/year or class_id)
- `evidence_link_ids` (JSON array — which `tse_evidence_links` rows were included, for exact reproducibility)
- `pdf_file_id` (references the existing PDF storage convention in `pdfService.js`)
- `created_at`

### 4.7 `tse_dsg_members` — new, multi-party (see §8 for the access-model discussion this requires)
- `id`, `owner_phone_hash` (the teacher being supported)
- `member_phone_hash` (the DSG participant — must already be a registered teacher in this system)
- `role` (`peer` | `hod`)
- `status` (`invited` | `active` | `revoked`)
- `scope_expires_at` (time-boxed access — DSG membership is not indefinite)
- `invited_at`, `responded_at`

### 4.8 `tse_dsg_comments`
- `id`, `dsg_member_id` (references `tse_dsg_members`)
- `target_type` (`portfolio_snapshot` | `visit_prep` | `reflection`), `target_id`
- `comment_text`
- `created_at`

**Migration numbering:** continues from the audit's recommendation — next available is **033**, all `CREATE TABLE IF NOT EXISTS`, all additive, same rollback profile (drop any subset with zero effect on existing tables).

---

## 5. API Contracts

Applying the audit's §7 principle: reuse `/api/classes` and `/api/learners` as-is; add only what has no existing analogue. All new endpoints sit under the existing JWT-authenticated pattern (`utils/teacherAuth.js`), scoped by `req.teacher.phoneHash` exactly like every hypothetical new endpoint in this codebase already would be.

| Method & path | Purpose | Auth scope | Notes |
|---|---|---|---|
| `GET /api/tse/status` | Per-category evidence snapshot for the current term (powers `MY GROWTH` on web and the WhatsApp equivalent) | Own data only | Deterministic aggregation over `tse_evidence_links`, no AI |
| `GET /api/tse/evidence?category=&term=&class_id=` | Browse linked evidence within a category | Own data only | Each item resolves back to its source table/row for display |
| `GET/POST /api/tse/reflections` | List / create-draft reflections | Own data only | POST creates a draft; a separate PATCH approves it |
| `PATCH /api/tse/reflections/:id` | Edit or approve a reflection | Own data only | Enforces the `draft → approved` transition |
| `GET/POST /api/tse/growth-plans` | List / create growth plans | Own data only | |
| `PATCH /api/tse/growth-plans/:id` | Update status/goals | Own data only | |
| `GET/POST /api/tse/visits` | List / log a classroom visit | Own data only | |
| `GET /api/tse/portfolio-snapshots` | List past portfolio exports | Own data only | |
| `POST /api/tse/portfolio-snapshots` | Build a new portfolio snapshot | Own data only | Triggers the same compilation service the WhatsApp `PORTFOLIO` command uses |
| `GET /api/tse/portfolio-snapshots/:id/pdf` | Download a specific snapshot's PDF | Own data only | |
| `GET/POST /api/tse/dsg/members` | List DSG members / invite a new one | Own data as owner; **new cross-teacher scope as invitee — see §8** | The one endpoint family that cannot use plain "own data only" scoping |
| `PATCH /api/tse/dsg/members/:id` | Accept/decline/revoke | Owner or the invited member, not arbitrary teachers | |
| `GET /api/tse/dsg/portfolio/:ownerPhoneHashId` | A DSG member's read-only view into an owner's shared evidence | Only valid for an `active`, non-expired `tse_dsg_members` row | Requires new authorization logic — no existing endpoint in this codebase currently checks "does requester X have permission to view teacher Y's data" |
| `POST /api/tse/dsg/comments` | Leave a comment on a shared item | Must be an active DSG member for that owner | |

No existing endpoint's method, path, or response shape changes.

---

## 6. AI Workflows

Each registers into the existing `promptService.js`/`aiService.js`/`generationPipeline.js` machinery exactly as `moderationPack` did — no new pipeline.

| Workflow | Input context assembled from | Output | Human-in-the-loop |
|---|---|---|---|
| Classroom Visit Prep brief | Recent `saved_resources` (lessonPlan type) for the class, `curriculum_coverage` standing, open `intervention_plans` | A structured prep brief (what's been taught, where coverage stands, active support work, likely discussion points) | Delivered directly; teacher can regenerate but there's no approval gate — same trust level as an existing lesson plan generation |
| Reflection drafting | Teacher's own short answers (§2.4) + that term's evidence summary | A narrative reflection in the teacher's voice | **Mandatory approval** — stored as `draft` until the teacher explicitly approves (§4.3) |
| Growth Plan goal drafting | Reflection content (if any), mastery/coverage patterns (ADR-007 chain, read-only), recurring intervention themes | 1–3 draft goals with target areas | Teacher selects/edits before save — plans are never auto-committed |
| Portfolio narrative (optional short intro per snapshot) | Compiled evidence set for the chosen scope | A one-paragraph professional summary framing the compiled evidence | Included in the PDF; teacher can regenerate before finalising |

No AI workflow computes coverage, mastery, or progress itself — all of that is read, never recomputed, from the existing ADR-007 service chain, matching the audit's §5.3 recommendation.

---

## 7. Permissions & Roles

The existing app has exactly one role: a teacher, scoped to their own `phone_hash`. TSE introduces the first genuine multi-party permission surface this codebase has had.

| Actor | Access | New or existing? |
|---|---|---|
| Teacher (owner) | Full read/write on their own evidence, reflections, growth plans, visits, portfolio | Existing model, unchanged |
| DSG member (peer or HOD) | **Read-only**, time-boxed, explicitly-granted access to one specific owner's shared evidence + comment ability | **New** |
| System/admin | Existing `utils/adminAuth.js` scope — no TSE-specific admin capability proposed at this stage | Existing, unchanged |

Recommend the DSG access model be built as an explicit **grant table** (`tse_dsg_members`, §4.7) checked on every DSG-scoped request, rather than any broader "school" or "HOD" role — this keeps the blast radius of the new permission surface to exactly the rows a teacher has explicitly shared, and requires no change to the existing single-teacher JWT/auth model (§8 elaborates why this matters).

---

## 8. A Flag Worth Its Own Section: DSG Is the One Piece That Doesn't Fit the Existing Model Yet

Every other capability in this spec is a straightforward extension of patterns that already exist in the codebase (audit §1.2–§1.6): new flow, new tables, new prompts, same auth. Development Support Group collaboration is different in kind, not degree — it's the first feature in this app's history where **one teacher's data needs to be visible to another logged-in identity.** Today, `utils/teacherAuth.js` resolves "this request is genuinely from teacher X" and every downstream query is scoped to that one `phoneHash`; there is no concept anywhere in the codebase of teacher X being authorized to see teacher Y's rows.

This isn't a reason to drop DSG from the plan — it's IQMS's actual governance model and the spec above (grant table, read-only, time-boxed, explicit invite/accept) is a reasonable, low-blast-radius way to add it. But it should be **called out as its own implementation phase with its own review**, not folded silently into "Phase 7 — UI" the way the rest of the Dashboard work can be. Recommend treating DSG as an explicit go/no-go decision point once Phases 2–6 are live and there's a real teacher base to validate the sharing model with.

---

## 9. Implementation Plan

Retaining the audit's phase structure, remapped to TSE branding, with DSG pulled out as its own explicit phase per §8:

- **Phase 1 — Architecture.** Complete (prior document).
- **Phase 2 — Evidence Engine.** `tse_evidence_categories`, `tse_evidence_links`; read-only aggregation service. No AI, no new commands exposed yet — dark-launched.
- **Phase 3 — MY GROWTH + Copilot surface.** New flow, new commands (§3), status snapshot live on WhatsApp and (once Phase 7 exists) the Dashboard.
- **Phase 4 — Classroom Visit Prep.** New prompt/intent, `tse_visits` table, WhatsApp flow.
- **Phase 5 — Reflections & Growth Plans.** `tse_reflections`, `tse_growth_plans`; two new AI-registered prompts with mandatory approval gates.
- **Phase 6 — Portfolio Builder.** `tse_portfolio_snapshots`; compilation via existing `pdfService.js`.
- **Phase 7 — Dashboard UI.** New pages for MY GROWTH, evidence browsing, reflections/growth plan editing, portfolio history — built on the existing `Layout`/`ui.jsx`/JWT stack.
- **Phase 8 — Development Support Group.** `tse_dsg_members`, `tse_dsg_comments`, the new cross-teacher authorization logic (§7–§8), and its own Dashboard surface. Explicit go/no-go review before starting, per §8.

Every phase leaves all existing tables, routes, prompts, flows, and commands untouched — no phase requires the app to be non-functional at any point, and every new table can be dropped independently with zero effect on the rest of the system.

---

*No production code is included in this document, per instruction. This specification is ready for review; implementation should not begin until it is explicitly approved, and Phase 4's name and Phase 8's access model in particular warrant explicit sign-off before their respective phases start.*
