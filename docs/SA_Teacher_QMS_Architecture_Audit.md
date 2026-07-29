# SA Teacher — AI Teacher Operating System
## Phase 1 Deliverable: Architecture Audit & QMS Integration Strategy

*Prepared as a planning document only. No files modified, no code generated, no dependencies installed. All recommendations preserve existing functionality, API routes, database tables, and WhatsApp workflows exactly as they exist today.*

---

## 1. Full Architecture Audit

### 1.1 System shape
SA Teacher is a **WhatsApp-first** CAPS-aligned teaching assistant for South African teachers, built on:

- **Runtime:** Node.js + Express (`server.js`), SQLite via `better-sqlite3` (`utils/database.js`), single-file DB on a Render persistent disk.
- **Transport:** Meta WhatsApp Cloud API (`routes/webhook.js`, `services/whatsappService.js`). A thin secondary **web dashboard** exists (`dashboard/` — React/Vite, JWT-authenticated) but is intentionally minimal today (Login, Home, Dashboard, Classes, ClassDetail), reading only `GET /api/classes` and `GET /api/learners`.
- **Payments:** Yoco webhook-driven subscription upgrades (`services/yocoService.js`, `payment_ledger` table, `utils/yocoWebhookVerifier.js`).

### 1.2 Message-handling architecture (the core of the app)
The app has already been through one deliberate modularisation effort (documented in `docs/adr/ADR-001` and `ADR-002`, tracked in `PROJECT_STATUS.md`). The current shape is:

```
routes/webhook.js  (thin orchestration layer, ~2340 lines, down from ~3390)
   └── core/messageProcessor.js   — processMessage(): dedup, opt-out check, phone
                                     encryption, non-text short-circuit, command
                                     dispatch, onboarding, mid-flow routing,
                                     intent classification, final dispatch
        └── core/commandHandler.js — keyword commands (STOP, PRO, STATUS, HELP,
                                      PROFILE, UPDATE, RETRY, workspace commands,
                                      SAVE/CANCEL, REPORT variants, TRANSLATE,
                                      differentiation commands)
        └── core/generationPipeline.js — shared AI-generation pipeline: rate
                                      limiting, Pro gating, quota deduction,
                                      prompt building, AI call, ATP grounding/
                                      retry, PDF attachment, SAVE-state publish
        └── flows/*.js — one file per multi-turn conversation, each with an
                          explicit "Expected deps shape" doc comment and a
                          `buildXDeps()` factory in webhook.js. No flow module
                          has a reverse dependency on webhook.js.
```

Existing flow modules: `observationFlow`, `workspaceFlow`, `worksheetFlow`, `assessmentFlow`, `assessmentSessionFlow`, `rosterFlow`, `reportCommentFlow`, `interventionPlanFlow`, `assessmentAnalysisFlow`, `parentMessageFlow`, `curriculumQueryFlow`, `profileUpdateFlow`.

**This is the single most important architectural fact for this project**: there is already a proven, load-bearing convention for adding a new capability without touching existing ones — a new `flows/<name>Flow.js`, a `build<Name>Deps()` factory, dependency injection (no `require('../routes/webhook')` anywhere), and a `SessionStore`-backed conversation state if the flow is multi-turn. Any QMS work should follow this convention exactly, not invent a new one.

### 1.3 Intent classification
`utils/intentParser.js` defines a fixed `INTENT_TYPES` enum (`lessonPlan`, `worksheet`, `test`, `examPaper`, `rubric`, `sbaTask`, `explanation`, `reportComment`, `parentMessage`, `quickQuiz`, `atp`, `assessmentAnalysis`, `dataAssessment`, `interventionPlan`, `moderationPack`, `observation`, `observationHistory`, `curriculumQuery`, `greeting`, `smallTalk`, `emotionalSupport`, `thanks`, `unknown`). `services/intentClassifier.js` layers an AI classifier with a regex fallback (the AI classifier is currently degraded — see §4 Risks — but the fallback works correctly). New QMS intents are a pure **addition** to this enum, not a change to any existing value.

### 1.4 Domain-service layering (the "data intelligence" stack)
`ADR-007` establishes a strict, one-directional composition chain that the codebase visibly honours:

```
learnerRepository.js
   → learnerTimelineService.js   (normalises assessment + observation events)
        → progressService.js     (trend analysis, percentage-bearing events only)
        → coverageService.js     (CAPS coverage, blueprint-backed events only)
             → masteryService.js  (combines progress + coverage per subject)
                  → interventionService.js
                       → classInterventionService.js (ADR-009, per-class rollup)
```

Every file in this chain explicitly documents what it does **not** do (no AI calls, no SQL of its own, no upward/downward shortcuts). This discipline is a major asset for QMS work: a QMS evidence/readiness engine should be added as a **new leaf consumer** of this chain (reading already-computed `ProgressReport`/`CoverageReport`/mastery output), never as a new branch that recomputes trend/coverage/mastery logic itself.

### 1.5 Identity & scoping model
- `teachers` (keyed by `phone_hash`, an HMAC of the phone number — no raw phone numbers are queried by business logic).
- `classes` (ADR-004: teacher-owned, nullable `class_id` on assessment-level entities is a supported "unclassed" state).
- `learners` (ADR-003/004: canonical + normalized name, uniquely scoped per teacher+class via two partial unique indexes handling classed vs. unclassed cases; `removed_at` soft-delete per ADR-006 PR3 preserves historical evidence even after roster changes).
- Every evidence-bearing table (`assessments`, `observation_assessments`, `intervention_plans`, `curriculum_coverage`, `reports`, `saved_resources`) is scoped by `phone_hash`, and increasingly by `class_id` and `learner_id`. This is exactly the scoping a QMS module needs and already exists — no new identity model is required.

### 1.6 Authentication
Two independent, deliberately non-overlapping auth models coexist (ADR-008):
- **WhatsApp/business logic:** plain `phoneHash` string, passed as a normal argument everywhere. No service is allowed to know HTTP/JWT exists.
- **Web dashboard:** JWT bearer tokens (`utils/teacherAuth.js`), OTP-based login (`routes/auth.js`, `auth_codes` table with HMAC'd codes, 5-minute expiry, one-time use). The JWT subject is `teachers.id`, not `phone_hash`, by design (so `phone_hash` can be rotated independently of issued tokens).
This means a QMS *dashboard* surface can be built entirely on the existing auth stack with zero new authentication code — it's an API-and-page addition, not an infrastructure addition.

### 1.7 Generation & document infrastructure
- `services/aiService.js` — model/timeout config per intent type (Claude primary, OpenAI fallback).
- `services/promptService.js` — dispatches intent type → prompt builder in `prompts/*.js`.
- `services/pdfService.js` — PDFKit-based generator; already produces question papers, memos, reports, and **moderation packs** with signature lines and formal cover sheets — the exact document shape IQMS/SACE-style evidence needs.
- `services/teacherWorkspaceService.js` — the generic "SAVE" lifecycle across 8 resource types (`worksheet, test, lessonPlan, atp, sbaTask, examPaper, rubric, moderationPack`), backed by `saved_resources`.
- `reports` table stores rendered `diagnostic | hod | parent` reports so they survive restarts.

### 1.8 What does *not* exist today
Confirmed by exhaustive search across the codebase (services, flows, prompts, schema, tests, docs): there is **no** existing table, service, prompt, or flow for portfolio compilation, professional reflection, a Personal Growth Plan, or a formal classroom-observation-of-the-teacher workflow. The word "observation" in this codebase means something specific and different from IQMS/SACE observation — see §4.1, this is the single biggest naming trap in the brief.

---

## 2. Existing Feature Inventory → QMS Evidence Mapping

| Existing feature | Where it lives | What it does today | QMS evidence it already produces |
|---|---|---|---|
| Lesson Plan generation | `prompts/lessonPlan.js`, generic `generationPipeline.js`, `saved_resources` | AI-generates a full CAPS lesson plan on request; savable | **Planning Evidence** — direct |
| Worksheet / Test / Exam Paper / SBA Task / Rubric generation | `generationPipeline.js`, `prompts/*.js` | AI-generates CAPS-aligned assessment/teaching materials; savable, PDF-eligible | **Planning + Assessment Evidence** |
| Assessment Blueprint lifecycle (ADR-005) | `services/blueprintRepository.js`, `blueprintTopicValidation.js`, `blueprintMarksImport.js`, `blueprint_*` tables | Draft/publish/archive/version a reusable, CAPS-validated assessment; teachers administer real assessments against it | **Assessment Evidence** — the strongest existing evidence source; versioned, so it can prove *what was actually administered*, not just a template |
| Assessment Session Engine (ADR-006) | `flows/assessmentSessionFlow.js`, `services/assessmentCaptureService.js`, `learner_results` | Conversational, per-learner marks capture against a blueprint/class/roster | **Assessment Evidence** — proof of administration and marking, not just generation |
| Moderation Pack generator | `prompts/moderationPack.js`, `services/promptService.js`, savable as `moderationPack` | Generates cover sheet, formal declaration, moderation checklist, reflection space, wrapping an existing or new assessment | **Moderation Evidence** — this is *already* a near-verbatim QMS artifact; it is the single closest existing feature to formal QMS paperwork |
| Diagnostic / Item / Error Analysis | `itemAnalysisService.js`, `errorAnalysisService.js`, `item_analysis`, `error_analysis` | Per-question difficulty, success rate, error-type frequency | **Assessment Quality Evidence** — feeds moderation-meeting-style reports (`interventionReportsService.js` already frames HOD reports "for moderation") |
| Intervention Plans / Class Intervention Rollup (ADR-009) | `interventionPlanService.js`, `classInterventionService.js`, `intervention_plans` | Rules-based + AI-assisted per-learner and per-class support plans, goals, monitoring plan, success indicators | **Learner Support Evidence** — directly maps to IQMS's "learner achievement/support" criterion |
| Curriculum Coverage tracking (ADR-007 §3.2) | `curriculumCoverageService.js`, `coverageService.js`, `curriculum_coverage` | Tracks ATP topic coverage vs. CAPS expectation per grade/subject/term, gap identification | **Curriculum Coverage Evidence** — directly maps to IQMS's "curriculum coverage" criterion |
| Progress / Mastery services (ADR-007 §3.1/§3.3) | `progressService.js`, `masteryService.js` | Per-subject achievement trend + mastery judgement | **Learner Achievement Evidence** |
| Foundation Phase Observation (learner-developmental) | `flows/observationFlow.js`, `utils/observationWorkflowService.js`, `observation_assessments/records` | Teacher records **learners'** developmental status per domain (NOT a classroom observation of the teacher) | **Assessment Evidence (Foundation Phase)** — but see §4.1: do not conflate with IQMS teacher-observation |
| Reports (diagnostic/HOD/parent) | `reports` table, `interventionReportsService.js` | Persists rendered reports; HOD report already explicitly framed for "departmental moderation" | **Accountability Evidence** |
| Teacher Workspace (classes, saved resources, workspace summary) | `teacherWorkspaceService.js`, `flows/workspaceFlow.js` | Class list, saved-resource browsing, assessment/progress summaries | **Portfolio scaffolding** — the natural index/table-of-contents layer for a portfolio |
| Teacher profile (grade/subject/school/language) | `teachers` table, `onboardingService.js` | Basic identity/context used to pre-fill every prompt | **Portfolio metadata** (cover page) |
| Learner roster management (ADR-006 PR3) | `flows/rosterFlow.js`, `learnerRosterService.js` | ADD/REMOVE/CLEAR/LIST roster per class | Underpins attribution of all of the above evidence to real, named learners |

**Not currently mapped to anything** (genuine gaps, not integration opportunities): professional reflection, a Personal Growth Plan, professional development/CPD logging, and any record of a teacher *being observed*. These require new, additive content types — described in §3 and §6 — not a repurposing of an existing feature.

---

## 3. Integration Opportunities — the QMS Copilot

The brief is explicit that QMS should not be "another disconnected module." Given the architecture in §1, the correct integration shape is:

1. **A thin, natural-language entry surface** (WhatsApp commands + free text like "how ready am I for QMS", "prepare me for tomorrow's observation") that behaves exactly like every other intent — classified by the existing `intentClassifier.js`/`intentParser.js`, routed by the existing `messageProcessor.js` dispatch, handled by a new `flows/qmsFlow.js` built with the same dependency-injection convention as every other flow.
2. **A read-only evidence layer** that queries — never duplicates — the tables already inventoried in §2 (`assessments`, `learner_results`, `intervention_plans`, `curriculum_coverage`, `reports`, `saved_resources`, `observation_assessments`), joins them by `phone_hash`/`class_id`/`learner_id`, and classifies each row against a fixed set of QMS evidence categories. This is the "Evidence Engine" the brief later names as Phase 3 — it is fundamentally a **read/tag/aggregate** service, not a new generation pipeline.
3. **A small set of genuinely new content types** for the things that have no existing analogue: professional reflection, Personal Growth Plan, and portfolio compilation/export. These follow the *exact same pattern* as `moderationPack` — a new prompt file, a new `INTENT_TYPES` entry, a registration in `promptService.js`/`aiService.js`, and eligibility for the existing SAVE/PDF lifecycle — rather than a bespoke pipeline.
4. **Natural-language "readiness" and "prepare me" queries** are best implemented as a small classification layer on top of (2), similar in spirit to `curriculumQueryFlow.js` (a stateless, single-message, "answer instantly from already-computed data" flow) — not a new AI-generation flow, since the underlying data is already known deterministically (which evidence categories have zero recent rows).

Nothing in this shape requires renaming any route, table, or existing prompt, and nothing requires the AI classifier to be *more* reliable than it is today — a QMS keyword command set (mirroring `STATUS`/`WORKSPACE`/`MY PROGRESS` etc.) gives a reliable non-AI entry point exactly like the rest of the app already does.

---

## 4. Risks

### 4.1 Naming collision: "Observation" already means something else (High — must resolve before Phase 4 naming is finalised)
The brief's Phase 4 ("Observation Assistant") and its own example ("Prepare me for tomorrow's observation") almost certainly mean **an HOD/peer observing the teacher** for IQMS purposes. But `observation` in this codebase is an established, tested, documented Foundation-Phase feature meaning **a teacher recording a learner's developmental status** (`flows/observationFlow.js`, `observation_assessments`, `OBSERVATION`/`OBSERVATION_HISTORY` intents, an entire ADR's worth of design). Reusing the bare word "observation" for the new teacher-being-observed concept in code, commands, or intents *will* cause real confusion (a teacher typing "OBSERVATION" would hit the existing Foundation Phase flow) and risks a maintenance-time mix-up between two semantically opposite things (teacher-observes-learner vs. HOD-observes-teacher).
**This must be named distinctly** — e.g. an "IQMS Observation Prep" or "Classroom Visit Prep" capability, with its own intent name (not `observation`) and its own command word. This is a naming decision, not a technical blocker, but it needs explicit sign-off before any Phase 4 work starts.

### 4.2 WhatsApp command namespace is already dense (Medium)
Existing exact-match commands include `STOP, PRO, UPGRADE, STATUS, USAGE, BALANCE, HELP, MENU, HI, HELLO, PROFILE, UPDATE, RETRY, CANCEL, SAVE, MY RESOURCES, WORKSHEET, TEST, LESSONPLAN, FORMAL, TRANSLATE`, plus workspace commands (`MY CLASSES, MY ASSESSMENTS, MY PROGRESS, WORKSPACE, NEW CLASS, CLASS INTERVENTION`) and roster commands (`ROSTER, LIST ROSTER, ADD LEARNER, REMOVE LEARNER, CLEAR ROSTER`). Any new QMS command set (e.g. a bare `PROGRESS` or `REPORT`) risks colliding with existing exact-match logic in `commandHandler.js`/`workspaceFlow.js`. New commands must be namespaced distinctly (e.g. `QMS`, `MY QMS`, `PORTFOLIO`, `GROWTH PLAN`, `REFLECT`) and checked against the full existing list before finalising.

### 4.3 AI classifier is currently degraded (Low-Medium, pre-existing and unrelated to this project)
`PROJECT_STATUS.md` notes the AI intent classifier is blocked on depleted Anthropic API credit, with the regex fallback carrying classification in the meantime. Any QMS natural-language intent ("how ready am I for QMS") will rely on the same AI classifier and inherit this same degraded state until it's resolved — a pre-existing condition, not something QMS introduces, but worth flagging since the brief leans heavily on "the AI should understand natural language."

### 4.4 Pro-gating decision needed for QMS features (Medium, business decision not technical risk)
Every AI-generation-heavy multi-turn flow in the app today (`interventionPlanFlow`, `assessmentAnalysisFlow`) is Pro-gated before any session state is created. A QMS Copilot that calls AI for reflections/growth plans will consume quota/AI cost the same way. Whether QMS evidence status-checking (deterministic, no AI) should be free-tier as a retention hook, while reflection/growth-plan generation (AI-backed) is Pro-only, is a product decision this audit surfaces but does not make unilaterally.

### 4.5 Reflection content may be sensitive (Low, mitigated by existing patterns)
Professional reflections are self-assessment text a teacher may not want visible outside their own portfolio. The codebase already has an established encryption pattern for sensitive fields (`utils/encryption.js`, `teachers.phone_enc`) — any new reflection storage should reuse that pattern rather than introduce a new one, but this needs no new infrastructure.

### 4.6 Dashboard is currently too thin to host "Portfolio Builder" UI as-is (Low, informational)
The web dashboard today has exactly two working data endpoints (`/api/classes`, `/api/learners`) and five pages. A Portfolio Builder UI (Phase 6/7) is a dashboard-first feature by nature (a document you browse and export, not a WhatsApp conversation) — this is not a risk to existing functionality, but it does mean Phase 6/7 has more net-new UI surface to build than the WhatsApp-side phases, and should be scoped and estimated accordingly.

---

## 5. Recommendations

1. **Treat the Evidence Engine (existing feature → QMS tag) as the foundation, not Phase 3.** The brief's own phase order (Copilot before Evidence Engine) is workable but backwards from a dependency standpoint: a Copilot that answers "how ready am I" needs the evidence classification to already exist. Recommend building the evidence-tagging/aggregation layer first (even a minimal version), then the Copilot's natural-language surface on top of it. This is a sequencing suggestion, not a change to what gets built.
2. **Resolve the "Observation" naming collision (§4.1) before writing a single line of Phase 4 code.** This should be an explicit decision point with the client/product owner, not an implementation detail decided in passing.
3. **Do not create a new "AI generation pipeline" for QMS content.** Reflections, growth plans, and portfolio narrative sections should register as new intent types through the *existing* `generationPipeline.js`/`promptService.js`/`aiService.js` registration pattern — identical to how `moderationPack` was added — so quota, Pro-gating, PDF eligibility, and SAVE all come for free and behave identically to every other resource type.
4. **Model the Evidence Engine as read-only queries + a new thin linking/tagging table, not a copy of existing data.** Evidence should always point back at its source row (a `saved_resources.id`, a `reports.id`, an `assessments.id`, an `intervention_plans.id`) so the underlying artifact stays the single source of truth and nothing needs to be kept in sync.
5. **New QMS-only content (reflections, growth plans, portfolio snapshots) needs new tables — but only these, and only additive ones.** No existing table needs a schema change to support QMS. See §6.
6. **Keep the QMS Copilot's own logic thin.** Per the brief's own instruction ("what should NOT move there"): lesson/worksheet/test/exam/rubric/SBA generation, moderation pack generation, intervention plan generation, assessment capture, curriculum coverage computation, and mastery/progress computation all stay exactly where they are. The QMS Command Centre only classifies, aggregates, links, and — for the genuinely new content types — generates reflection/growth-plan/portfolio text.
7. **Namespace every new command and intent distinctly** (§4.2) and cross-check against the full list in `core/commandHandler.js` and `utils/intentParser.js` before finalising command words.
8. **Decide Pro-gating policy for QMS features explicitly (§4.4)** before Phase 2 implementation, since it changes where the Pro-gate check needs to sit in `qmsFlow.js`.

---

## 6. Suggested Database Changes

**Principle applied:** no existing table's columns, meaning, or constraints change. Everything below is new tables only, following the exact additive-migration convention already used for the last 9 migrations (`CREATE TABLE IF NOT EXISTS`, wrapped index creation, migration comments explaining *why*).

| New table (proposed name) | Purpose | Rationale for being separate from existing tables |
|---|---|---|
| `qms_evidence_categories` | Small reference table: the fixed list of QMS evidence categories (Planning, Assessment, Moderation, Learner Support, Curriculum Coverage, Professional Reflection, Personal Growth Plan, Observation Prep) | A reference/lookup table, not a data table — avoids hardcoding the category list in application code only |
| `qms_evidence_links` | Links a `(phone_hash, class_id?, evidence_category, source_table, source_id, created_at)` row to whichever existing table actually holds the artifact | This is the entire "Evidence Engine" data model. It never duplicates content — it only tags what already exists. Dropping this table entirely rolls back cleanly with zero effect on any existing feature |
| `qms_reflections` | Stores professional reflection text (teacher-authored or AI-assisted), scoped by `phone_hash` and optionally linked to an assessment/class/observation-prep event | Genuinely new content type with no existing home |
| `qms_growth_plans` | Stores Personal Growth Plan goals, target areas, timelines, status | Genuinely new content type; distinct lifecycle from `intervention_plans` (which is about *learners*, not the *teacher's own* development) |
| `qms_portfolio_snapshots` | Records a generated portfolio export (what evidence was included, when, as a PDF via the existing `pdfService.js`) | Mirrors the existing `reports` table's "persist the rendered output" pattern, so a portfolio can be re-fetched without re-generating |

**Migration risk:** Very low. Every new table is additive, has no foreign key that existing tables must satisfy (only the reverse — new tables reference existing `teachers.phone_hash` / `classes.id`, same as every other table added in the last two years of this schema's history), and requires zero changes to `runMigrations()`'s existing blocks. Next migration number available: **033** (last used: 032, `auth_codes`).

**Rollback strategy:** Because nothing existing is altered, rollback is `DROP TABLE` for any subset of the five new tables — no data migration, no backfill, no risk to `teachers`, `assessments`, `learner_results`, `intervention_plans`, `curriculum_coverage`, `saved_resources`, or any other existing table. This is the same rollback profile as every prior additive migration in this schema.

**Explicitly not recommended:** adding QMS columns directly onto `assessments`, `intervention_plans`, `curriculum_coverage`, or `saved_resources` (e.g. a `qms_category` column on each). That would require touching five separate tables' write paths (every service and flow that inserts into them) for a classification that a single linking table can express without touching any of them.

---

## 7. Suggested API Changes

**Principle applied:** reuse existing endpoints wherever possible; only add new ones where no existing endpoint could reasonably serve the purpose.

- **WhatsApp side:** no new API endpoints at all — QMS is reachable entirely through `routes/webhook.js`'s existing POST endpoint, via new commands/intents routed to `flows/qmsFlow.js`, exactly like every other feature.
- **Dashboard/API side:** the existing `routes/api.js` currently exposes only `GET /api/classes` and `GET /api/learners` (per the Dashboard.jsx comment: "no fabricated ... numbers until a backend service produces them"). A QMS dashboard surface (Phase 6/7) would need a small number of new **read** endpoints under the same JWT-authenticated pattern already established by `utils/teacherAuth.js` (e.g. an evidence-status endpoint, a portfolio-snapshot listing/download endpoint). These are additive routes in `routes/api.js`, not changes to the two existing ones, and would reuse `req.teacher.phoneHash` exactly as any new endpoint in this codebase already would.
- **No renamed routes, no changed request/response shapes** for `/api/classes` or `/api/learners`.

---

## 8. Suggested UI Structure

Given the dashboard's current, deliberately minimal state (§1.2, §4.6), recommend a phased UI approach rather than a single new "QMS Command Centre" page shipped all at once:

- **WhatsApp-first (Phases 2–5):** all QMS interaction happens in-chat — status summaries, missing-evidence lists, reflection prompts, growth-plan generation — exactly like every other feature today. No new UI surface needed for these phases.
- **Dashboard (Phase 6–7, once there's enough evidence data to browse):** a new page (e.g. `dashboard/src/pages/QMSPortfolio.jsx`), added alongside — not replacing — `Classes.jsx`/`ClassDetail.jsx`, following the same `Layout`/`ui.jsx` component conventions already established. This is where a teacher would browse evidence by category, review/edit a reflection, and download a compiled portfolio PDF. This should be scoped as genuinely new UI work (§4.6), not a retrofit of an existing page.

---

## 9. Suggested AI Workflows

Each of these should be added the same way `moderationPack` was: a new `prompts/<name>.js`, a registration in `promptService.js`'s intent-type switch, and a model/timeout entry in `aiService.js` — nothing bespoke.

| Workflow | Trigger (natural language, examples) | What it produces | Existing data it reads (via qms_evidence_links + the ADR-007 chain) |
|---|---|---|---|
| QMS readiness check | "How ready am I for QMS?" | A deterministic (non-AI) status summary per evidence category — no generation needed, just aggregation | All linked evidence rows for the current term |
| Missing-evidence finder | "Show missing reflections" / "Find moderation documents" | A deterministic list of gaps (e.g. classes with no linked moderation pack this term) | `qms_evidence_links` joined against `classes`/`assessments` |
| Observation/classroom-visit prep *(name pending §4.1 resolution)* | "Prepare me for tomorrow's [classroom visit]" | AI-generated prep notes drawing on recent lesson plans, coverage status, and intervention activity for the relevant class | `saved_resources` (lessonPlan type), `curriculum_coverage`, `intervention_plans` |
| Professional reflection assistant | "Help me reflect on this term" | AI-drafted reflection the teacher edits/approves, stored in `qms_reflections` | Recent assessment/intervention/coverage activity as prompts/context |
| Personal Growth Plan generator | "Generate my Personal Growth Plan" | AI-drafted goals/target areas based on observed patterns (e.g. a subject with weak coverage or recurring learner-support needs) | Mastery/coverage output (already computed, not recomputed) |
| Portfolio Builder | "Build my portfolio" | Compiles linked evidence + reflections + growth plan into a single PDF via the existing `pdfService.js`, recorded in `qms_portfolio_snapshots` | Everything above |

---

## 10. Suggested Implementation Phases

Retaining the brief's phase names, with one sequencing note (§5.1) flagged explicitly rather than silently changed:

- **Phase 1 — Architecture** *(this document).* Complete.
- **Phase 2 — Evidence Engine** *(recommend building before/alongside the Copilot rather than strictly after it, per §5.1)*. New tables (`qms_evidence_categories`, `qms_evidence_links`); a new read-only `qmsEvidenceService.js` that classifies and aggregates existing rows. No AI, no new prompts, no UI. Fully additive — safe to ship and dark-launch behind a command that doesn't exist for teachers yet.
- **Phase 3 — QMS Copilot.** New `flows/qmsFlow.js`, new namespaced commands, new intent types in `intentParser.js`, wired into `messageProcessor.js`'s existing mid-flow routing exactly like every other flow. Answers status/gap questions deterministically from Phase 2's data.
- **Phase 4 — IQMS Observation/Classroom-Visit Prep** *(name to be finalised per §4.1 before this phase starts)*. New prompt + intent, reading existing lesson-plan/coverage/intervention data.
- **Phase 5 — Professional Growth.** `qms_reflections`, `qms_growth_plans` tables; new prompts for reflection assistance and growth-plan generation, registered through the existing generation pipeline.
- **Phase 6 — Portfolio Builder.** `qms_portfolio_snapshots` table; a compilation service producing a PDF via the existing `pdfService.js`.
- **Phase 7 — UI.** New dashboard page(s) for browsing evidence and portfolios, once Phases 2–6 have real data to display.

Each phase, as built, leaves `routes/webhook.js`, every existing flow, every existing service, every existing table, every existing API route, and every existing WhatsApp command completely unchanged and fully functional — consistent with the brief's non-negotiable rules.

---

*No code was written and no files were modified in the preparation of this document. All file/table/service names above refer to artifacts that already exist in the audited codebase, confirmed by direct inspection.*
