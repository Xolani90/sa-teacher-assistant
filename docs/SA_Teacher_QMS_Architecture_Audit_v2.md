# SA Teacher — Architecture Audit & QMS Integration Strategy (Phase 1)

**Scope:** Planning only. No files modified, no code written, no dependencies installed. This document is the output of a read-only audit of the uploaded `sa-teacher-assistant` codebase, intended to be reviewed and approved before any implementation begins.

---

## 0. What this codebase actually is (context for everything below)

SA Teacher is a **WhatsApp-first AI teaching assistant** for South African (CAPS-aligned) teachers, with a companion React dashboard and a JSON API. The WhatsApp bot is the primary surface — teachers text commands like `WORKSHEET`, `LESSONPLAN`, `TEST`, or natural language, and the backend classifies intent, builds a CAPS-aware prompt, calls an LLM, and returns/saves a resource. There is real production hardening here already (Sentry, idempotency keys, rate limiting, a payment ledger, migration discipline, ADRs) — this is not a prototype.

This matters for the QMS mission: **QMS integration must ride on top of an already-disciplined layered architecture**, not bolt onto a loose one. That is good news — it means the "quietly prepare the portfolio in the background" goal is architecturally realistic, because almost every teacher action already flows through a small number of chokepoints (`generationPipeline.js`, `saved_resources`, `reports`, `learner_results` / `observation_records`).

---

## 1. Architecture Audit

### 1.1 Frontend
- **`dashboard/`** — a separate Vite + React + Tailwind SPA (React Router, its own `TeacherContext` auth context, `api/client.js` for the JSON API). Pages: `Home`, `Login`, `Dashboard`, `Classes`, `ClassDetail`.
- This is a **secondary, thin surface**. Teachers primarily interact via WhatsApp; the dashboard appears to be an emerging view layer (classes/learners) rather than the primary generation UI. Any QMS UI work should assume WhatsApp remains the main channel and the dashboard is where a "Command Centre" visual home would live.

### 1.2 Backend
- **`server.js`** — Express app bootstrap: Sentry, env validation, migrations, security middleware (helmet, rate limiting), three routers (`webhook`, `api`, `auth`), production DB-path safety check (refuses to boot if `DB_PATH` isn't on a persistent volume — a strong signal this app has been burned by data loss before, i.e. treat the DB with care).
- **`routes/webhook.js`** — WhatsApp (Meta) inbound webhook, HMAC-verified.
- **`routes/api.js`** — teacher-facing JSON API (teacher-auth gated, per ADR-008).
- **`routes/auth.js`** — WhatsApp OTP-based teacher auth.
- **`core/`** — the orchestration layer:
  - `messageProcessor.js` — top-level WhatsApp message router.
  - `commandHandler.js` — literal commands (`HELP`, `SAVE`, `STATUS`, `PROFILE`, `RETRY`, `CANCEL`, `TRANSLATE`, etc.).
  - `generationPipeline.js` — **the single chokepoint** every AI-generated resource passes through: quota gating, prompt building, AI call, PDF eligibility, save-eligibility (`saveableTypes`), idempotency.
- **`flows/`** — one file per multi-turn conversational workflow (assessment capture, observation capture, intervention planning, roster management, curriculum queries, parent messaging, report comments, worksheet/workspace flows). This is the ADR-001 "flow boundary" pattern — each flow owns a distinct conversational state machine.
- **`services/`** — business logic, one concern per file (see §2 for the full inventory). Notably layered per `docs/ARCHITECTURE.md`: `learnerRepository` → `learnerTimelineService` → `{ProgressService, CoverageService}` → `MasteryService` → `InterventionService` → delivery surfaces (WhatsApp / PDF / API). This is a genuinely clean dependency-inversion pattern with an explicit "allowed dependencies" table and matching test-isolation strategy.
- **`utils/`** — cross-cutting: `database.js` (schema + migrations), auth, encryption, parsers, logger, session store.
- **`prompts/`** — one prompt-builder per resource type (14 types — see §2).

### 1.3 Database
SQLite (`better-sqlite3`), migration-driven (`runMigrations()` in `utils/database.js`, numbered inline migrations up to at least #030). Key tables:

| Table | Purpose |
|---|---|
| `teachers` | Profile, subscription status (`is_pro`, `pro_expires`) |
| `classes` | Teacher's classes (name, grade, subject, learner_count) |
| `learners` | Class-aware learner identity (ADR-003/004) |
| `assessments` / `learner_results` | Captured marks per assessment |
| `assessment_blueprints` / `blueprint_questions` | Reusable, versioned, CAPS-tagged question metadata (ADR-005) |
| `item_analysis` / `error_analysis` | Per-question and per-error diagnostic data |
| `intervention_plans` | Persisted intervention plans |
| `curriculum_coverage` | CAPS topic coverage tracking |
| `observation_assessments` / `observation_records` | Foundation Phase developmental observations |
| `saved_resources` | **Every AI-generated resource a teacher explicitly saves** (worksheet, test, lessonPlan, atp, sbaTask, examPaper, rubric, moderationPack) — has `metadata` (JSON) and `generation_id` (idempotency) |
| `reports` | Persisted diagnostic / HOD / parent reports, keyed to an assessment |
| `sessions`, `auth_codes`, `payment_ledger`, `usage_events`, `subscriptions`, `onboarding`, `rate_limit_events` | Infra/session/billing — not curriculum-relevant |

**This is the most important finding for QMS design:** `saved_resources` and `reports` are already generic, already timestamped, already phone_hash-scoped, and already have a JSON `metadata` column. A QMS evidence layer does **not** need its own resource-storage table — it needs a thin **classification layer** over what's already being saved (see §5).

### 1.4 Existing AI features (14 resource types, via `generationPipeline.js` + `promptService.js`)
`lessonPlan`, `worksheet`, `test`, `examPaper`, `rubric`, `sbaTask`, `explanation`, `reportComment`, `parentMessage`, `quickQuiz`, `atp` (Annual Teaching Plan), `assessmentAnalysis`, `interventionPlan`, `moderationPack` — plus `observation` / `observationHistory` / `curriculumQuery` as non-generation intents (`utils/intentParser.js` `INTENT_TYPES`).

### 1.5 Existing teacher workflows (`flows/`)
`assessmentFlow`, `assessmentSessionFlow` (multi-turn WhatsApp marks-capture state machine, ADR-006), `assessmentAnalysisFlow`, `interventionPlanFlow`, `observationFlow` (Foundation Phase), `curriculumQueryFlow`, `parentMessageFlow`, `profileUpdateFlow`, `reportCommentFlow`, `rosterFlow`, `worksheetFlow`, `workspaceFlow` (the "teacher workspace" — `SAVE`, resource listing, class intervention rollups, learner progress reports).

### 1.6 Authentication
Two separate schemes, intentionally not yet unified (documented as a known gap in `docs/ARCHITECTURE.md`):
- **WhatsApp**: identity = sender's phone number (hashed → `phone_hash`).
- **API/dashboard**: `requireTeacherAuth` (ADR-008, OTP-based) for teacher-scoped endpoints; `requireAdminSecret` (shared secret) for admin/internal endpoints — explicitly documented as *not* per-teacher and *not* meant for teacher-facing use long-term.
- No moderator/HOD/subject-head role exists yet. **This is directly relevant to QMS** — moderation sign-off, HOD verification, and school-level dashboards all imply a role this system doesn't have today.

### 1.7 Resource generation
Fully centralized in `generationPipeline.js` (gating → prompt → AI call → PDF-eligibility → save-eligibility). `services/aiService.js` maps each resource type to a model + token budget + timeout (with an OpenAI fallback model per type, interesting resilience choice). `services/pdfService.js` renders any saveable type to a printable PDF (cover block, per-type template) and cleans up old PDFs on a schedule.

### 1.8 Classes / Learners / Assessments / Reports / Curriculum
- **Classes**: simple, teacher-owned, one row per (grade, subject) grouping. `learner_count` denormalized (kept in sync — see `learner-roster-service.test.js`).
- **Learners**: class-aware identity resolution (ADR-003/004) — handles re-identifying the "same" learner across sessions/classes, which is genuinely hard in a WhatsApp-text context (no learner logins).
- **Assessments**: header/detail split (`assessments` + `learner_results`), with blueprint-backed (structured, CAPS-tagged) and free-form paths both supported.
- **Reports**: `diagnostic` / `hod` / `parent` types already exist and are persisted, keyed to an assessment.
- **Curriculum**: `curriculum_coverage` + `curriculumCoverageService` + `curriculumIntelligenceService` compare taught/assessed topics against CAPS expected-topic lists per grade/term/subject.

### 1.9 Existing reusable components worth naming explicitly (because QMS should consume, not duplicate, these)
- `learnerTimelineService` — the canonical merged event stream (assessments + observations) per learner. Any "evidence timeline" for QMS should be a **view over this**, not a new timeline.
- `MasteryService` / `InterventionService` — already produce the exact "evidence + judgement + recommended action" shape QMS evidence needs.
- `pdfService.js` — already the single PDF rendering surface; a portfolio PDF should be a new *template*, not a new renderer.
- `teacherWorkspaceService.js` — already lists/filters a teacher's saved resources by type (`KNOWN_RESOURCE_TYPES`); this is the natural home for a "what QMS evidence exists" query.

---

## 2. Existing Feature → QMS Evidence Mapping

For every existing feature: what it does, where it lives, how it becomes QMS evidence.

| Feature | Lives in | → QMS Evidence Category |
|---|---|---|
| Lesson Plans (`lessonPlan`) | `prompts/lessonPlan.js`, saved via `saved_resources` | **Planning & Preparation evidence** |
| Annual Teaching Plan (`atp`) | `prompts/atp.js`, `utils/atpWeekValidator.js` | **Curriculum Planning evidence** (whole-year) |
| Worksheets / Tests / Exam Papers / Quick Quiz | `prompts/{worksheet,test,examPaper,quickQuiz}.js` | **Teaching & Assessment Resource evidence** |
| Rubrics / SBA Tasks | `prompts/{rubric,sbaTask}.js` | **Assessment Design evidence** |
| Moderation Pack | `prompts/moderationPack.js`, `services/promptService.js` | **Moderation evidence** — this is *already* explicitly modelled as "sample of tasks + memo + rubric + moderation checklist for HOD sign-off." This is the single closest existing feature to a QMS artifact. |
| Assessment capture (marks) | `flows/assessmentSessionFlow.js`, `assessments`/`learner_results` | **Assessment Administration evidence** (proof marks were captured, when, for whom) |
| Item/Error Analysis | `services/itemAnalysisService.js`, `services/errorAnalysisService.js` | **Diagnostic Evidence** |
| Assessment Analysis reports | `flows/assessmentAnalysisFlow.js`, `reports` table (`diagnostic`) | **Diagnostic/Analysis Evidence** |
| Intervention Plans | `services/interventionPlanService.js`, `services/interventionService.js`, `intervention_plans` table | **Learner Support Evidence** |
| Class Intervention rollups | `services/classInterventionService.js` | **Class-level Support Evidence** (useful for HOD-level QMS review) |
| Diagnostic / HOD / Parent Reports | `reports` table, `flows/reportCommentFlow.js` | **Communication & Accountability Evidence** |
| Curriculum Coverage tracking | `services/curriculumCoverageService.js`, `curriculum_coverage` table | **Curriculum Delivery Evidence** — proof of what was actually taught vs CAPS-expected |
| Foundation Phase Observations | `flows/observationFlow.js`, `observation_assessments`/`observation_records` | **Alternative Assessment Evidence** (non-numeric, developmental) |
| Learner Timeline | `services/learnerTimelineService.js` | **Longitudinal Evidence Spine** — the backbone a portfolio builder should read from |
| Mastery / mastery judgement | `services/masteryService.js` | **Evidence of Response to Data** (did the teacher act on what the data showed?) |
| Roster management | `flows/rosterFlow.js`, `services/learnerRosterService.js` | **Administrative/Class Management Evidence** |
| Onboarding / Profile | `services/onboardingService.js`, `flows/profileUpdateFlow.js` | Not QMS evidence — teacher identity/config only |

**Notable gap:** there is **no existing "Professional Reflection" feature** anywhere in the codebase (confirmed by search — no reflection prompt, service, table, or flow exists). The mission brief's example (`Reflection → Professional Reflection`) is aspirational, not a rename of something that already exists. This is real net-new scope, not a mapping exercise, and should be budgeted as such in the roadmap.

**Also notable:** there is no HOD/moderator role or sign-off mechanism anywhere yet (see §1.6). "Moderation documents" can be *generated* (`moderationPack`) but there is no workflow for a second party to *approve* one. QMS Copilot's "find moderation documents" can only ever mean "find moderation packs I generated," not "show me sign-off status," until a role model exists.

---

## 3. AI QMS Copilot — Integration Design

### Principle
The Copilot is **not a new feature surface** — it is a **natural-language query + gap-detection layer over data that already exists**, exposed through the *same* channels teachers already use (WhatsApp intents, dashboard). This satisfies the mission's explicit constraint: teachers should never "do QMS" as a separate act.

### How it plugs into the existing architecture (no invasive changes)
1. **New intent types**, added to `INTENT_TYPES` in `utils/intentParser.js` (additive enum values only — nothing renamed/removed):
   - `qmsReadiness` ("How ready am I for QMS?")
   - `qmsPrepare` ("Prepare me for tomorrow's observation")
   - `qmsGapCheck` ("Generate missing evidence" / "Show missing reflections")
   - `qmsPortfolio` ("Build my portfolio")
   - `qmsGrowthPlan` ("Generate my Personal Growth Plan")
   - `qmsModerationLookup` ("Find moderation documents")
2. **New flow**, `flows/qmsCopilotFlow.js`, following the exact same pattern as every other flow file — it does not reach into raw SQL; it composes existing services:
   - Reads from `teacherWorkspaceService` (what's been saved, by type/date), `learnerTimelineService` (evidence-per-learner), `curriculumCoverageService` (coverage gaps), `reports` (existing HOD/diagnostic/parent reports).
   - For genuinely new concepts (readiness score, gap list, growth plan), it composes a **new, thin service** (`services/qmsReadinessService.js`) that only *reads* the above — mirroring the existing "services consume contracts, not storage" rule from `docs/ARCHITECTURE.md`.
3. **Gap-filling generation** ("Generate missing evidence") is not a new generation mechanism — it routes back through the **existing** `generationPipeline.js` with the appropriate existing intent type (e.g. a missing lesson plan gap triggers the existing `lessonPlan` intent, pre-filled with the relevant class/topic context). The Copilot's job is to *decide what's missing and pre-fill the ask* — never to duplicate the generation pipeline.
4. **Natural language understanding** reuses the existing `services/intentClassifier.js` classification pattern (few-shot intent classification already in place for 19+ intent types) — the QMS intents are additional entries in the same classifier prompt, not a new NLU stack.

### What the Copilot explicitly does NOT do
- It does not generate net-new evidence types speculatively (e.g. it will not invent "reflection" content on a teacher's behalf without the teacher describing what happened — that would be dishonest evidence, not automation of paperwork).
- It does not touch moderation *sign-off* — because no sign-off mechanism exists (see §2 gap). It can find/list moderation packs but cannot mark anything "moderated" without new schema + a new role (flagged as a Phase 4+ decision, not assumed here).

---

## 4. Proposed New Module: QMS Command Centre

### Purpose
A single place — reachable from WhatsApp (`QMS` command / natural language) and the dashboard (new `/qms` route) — where a teacher sees their portfolio readiness at a glance, without any of the underlying evidence living in a new silo.

### Responsibilities
- Present a **readiness score/summary** per QMS category (Planning, Assessment, Moderation, Learner Support, Curriculum Delivery, Reflection) computed from existing tables.
- Surface **gaps** ("no reflection logged for Term 3", "2 classes have no lesson plan on record this term").
- Trigger **portfolio export** (a new PDF template in the existing `pdfService.js`, composing existing saved resources + reports + a cover/table-of-contents).
- Own the **Personal Growth Plan** artifact — this is genuinely new content (AI-synthesized from mastery/intervention/coverage/reflection data), so it gets a new prompt (`prompts/personalGrowthPlan.js`) and a new `reports`-table row (`report_type = 'growthPlan'` — reuses the existing table rather than adding a new one, since `reports` is already generic: phone_hash, type, content, created_at).

### How it integrates
- Sits **beside** `teacherWorkspaceService`, not above the domain services — it is a read-and-compose layer, same level as `flows/workspaceFlow.js` architecturally.
- Dashboard-side: new page `dashboard/src/pages/QMS.jsx`, calling new *read-only* API endpoints under `/api/qms/*` (reusing `requireTeacherAuth`).
- WhatsApp-side: new flow `flows/qmsCopilotFlow.js` (see §3).

### What it stores
- **Nothing net-new except**: (a) a `reports.report_type = 'growthPlan'` row per generated growth plan (existing table, additive value), and (b) *if* Phase 3 (Evidence Engine, see §7) determines classification metadata is needed, a small denormalized tagging table (see §5) — not the evidence itself, which stays in `saved_resources`/`reports`/`learner_results`/`observation_records` exactly where it is today.

### What should NOT move there
- Any actual generation logic (stays in `generationPipeline.js` + `prompts/`).
- Any mastery/intervention/coverage computation (stays in the existing `MasteryService`/`InterventionService`/`CoverageService` layer — QMS Command Centre reads their output, never recomputes it, per the existing "services consume contracts" rule).
- Learner data ownership (stays in `learnerRepository`).
- Reflection *content* generation — reflections should be teacher-authored (possibly AI-assisted phrasing), not fabricated wholesale, for integrity reasons.

---

## 5. Recommended Database Changes

**Preference: none, if avoidable — reuse `saved_resources` / `reports` metadata columns first.**

If, after Phase 3 discovery, the team finds free-text `metadata` JSON on `saved_resources` is not queryable enough for readiness scoring at scale, the **only** change recommended is:

```sql
-- Additive only. No existing table altered destructively.
CREATE TABLE IF NOT EXISTS qms_evidence_tags (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_hash      TEXT    NOT NULL,
  source_table    TEXT    NOT NULL,   -- 'saved_resources' | 'reports' | 'learner_results' | 'observation_records'
  source_id       INTEGER NOT NULL,
  qms_category    TEXT    NOT NULL,   -- 'planning' | 'assessment' | 'moderation' | 'support' | 'coverage' | 'reflection'
  term            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (phone_hash) REFERENCES teachers(phone_hash)
);
```

**Why this shape:** it's a pure tagging/join table — it never becomes the source of truth for evidence content, so it can be dropped and rebuilt from the source tables at any time with zero data loss. This is the lowest-risk way to add "queryable QMS structure" without touching a single existing table.

**Migration risk:** minimal — `CREATE TABLE IF NOT EXISTS`, following the exact pattern already used for every other migration in `utils/database.js`. No ALTER of existing tables, no backfill required to ship (can be populated lazily as resources are tagged going forward).

**Rollback strategy:** drop the table; nothing else depends on it structurally (by design — it's a derived index, not a foreign-key target from any existing table).

**Explicitly rejected for now:** adding QMS columns directly onto `saved_resources`/`reports` (couples an evidence-classification concern to the generation-storage schema — violates the same "reaching past a layer" anti-pattern the existing architecture doc warns against) and a new dedicated "portfolio" table (portfolios are a view/export, not a stored entity, until proven otherwise).

---

## 6. Recommended API Changes

**Preference: none — reuse existing endpoints wherever possible**, per the mission's non-negotiable rules.

New, additive, read-mostly endpoints only, all under `requireTeacherAuth` (existing middleware, unchanged):

- `GET /api/qms/readiness` — composes existing services (`teacherWorkspaceService`, `curriculumCoverageService`, `masteryService`) into a summary. No new auth model.
- `GET /api/qms/gaps` — same composition, gap-focused.
- `POST /api/qms/portfolio` — triggers existing `pdfService.js` with a new template; returns existing PDF-download token pattern already used for other PDFs (no new download mechanism).
- `POST /api/qms/growth-plan` — routes through the **existing** `generationPipeline.js` gating/quota logic (a growth plan is just a 15th resource type, not a new pipeline) and existing `reports` persistence.

**No existing route, verb, path, or response shape changes.** No renamed endpoints. `GET /api/learners/:learnerId/intervention-plan` and all other existing endpoints are untouched.

---

## 7. Risks

| Risk | Notes |
|---|---|
| **Auth model gap** | No HOD/moderator role exists. Any QMS feature implying second-party sign-off (moderation approval, HOD verification) needs a new ADR for roles *before* implementation — flagged, not solved here. |
| **Reflection is net-new** | Not a mapping of an existing feature; needs its own prompt, storage decision (`reports.report_type='reflection'` recommended), and — importantly — a design decision on how much the AI should draft vs. the teacher should author, to keep evidence honest. |
| **Metadata query performance** | `saved_resources.metadata` is JSON-in-TEXT; if QMS readiness queries need to filter/aggregate by class/term/topic at scale, the `qms_evidence_tags` table (§5) becomes necessary sooner rather than later. Worth a quick data-volume check before Phase 3. |
| **PDF template growth** | `pdfService.js` already renders 8 saveable types; a portfolio template that concatenates many sub-documents needs memory/timeout budgeting (existing `cleanupOldPdfs` scheduled job and per-type timeout pattern in `aiService.js` should be extended, not replaced). |
| **Scope creep into "AI grades my QMS readiness"** | Readiness scoring should surface facts (counts, gaps, dates) rather than issue a subjective compliance verdict the school could later dispute — recommend the copilot always shows its evidence list alongside any score. |
| **WhatsApp intent collision** | Adding 5–6 new intent types increases classifier ambiguity risk (e.g. `qmsPrepare` vs. existing `lessonPlan`/`observation` intents). `services/intentClassifier.js` already handles fine-grained disambiguation (see `moderationPack` vs `sbaTask` vs `rubric` prompt guidance) — new QMS intents need equally explicit few-shot disambiguation examples added to the same prompt, not a parallel classifier. |

---

## 8. Recommendations (summary)

1. Build QMS as a **read/compose layer**, not a parallel system — it should be nearly impossible to find "QMS-only" business logic anywhere except readiness scoring and growth-plan synthesis.
2. Extend `INTENT_TYPES` and the existing intent classifier prompt rather than building new NLU.
3. Reuse `saved_resources` and `reports` for storage; add `qms_evidence_tags` only if/when query needs demand it.
4. Route all new generation (growth plans, gap-fill prompts) through the existing `generationPipeline.js`.
5. Treat "moderation sign-off" and "HOD verification" as an explicitly separate, future ADR (roles/auth) — do not implicitly assume it in early phases.
6. Treat "Professional Reflection" as net-new product scope, budgeted honestly, not a costless rename.

---

## 9. Suggested UI Structure

- **WhatsApp**: `QMS` becomes a recognized command (alongside `HELP`, `STATUS`) that opens `flows/qmsCopilotFlow.js`; natural-language QMS questions are also routed here via the intent classifier — no new command syntax required for the natural-language path.
- **Dashboard**: new top-level nav item "QMS" → `/qms` route:
  - Readiness summary (per category, from §4).
  - Gap list with one-tap "generate this" (pre-fills and hands off to the existing generation flow).
  - "Build Portfolio" button (PDF export).
  - "Generate Growth Plan" button.
- Existing pages (`Classes`, `ClassDetail`, `Dashboard`) are **unchanged** — QMS surfaces evidence that already appears there; it does not duplicate those views.

---

## 10. Suggested AI Workflows (natural language examples → resolved action)

| Teacher says | Resolves to |
|---|---|
| "Prepare me for tomorrow's observation" | `qmsPrepare` → pulls upcoming class/period context (if known), recent lesson plans, recent assessment/observation evidence for that class, surfaces a pre-observation checklist |
| "How ready am I for QMS?" | `qmsReadiness` → category-by-category summary with counts and gaps, no invented verdicts |
| "Generate missing evidence" | `qmsGapCheck` → list of gaps, each with a one-tap trigger back into the existing `generationPipeline.js` for the right resource type |
| "Show missing reflections" | `qmsGapCheck` scoped to `reflection` category |
| "Find moderation documents" | `qmsModerationLookup` → queries `saved_resources` where `resource_type = 'moderationPack'`, via `teacherWorkspaceService` |
| "Build my portfolio" | `qmsPortfolio` → PDF export |
| "Generate my Personal Growth Plan" | `qmsGrowthPlan` → new prompt, existing pipeline, `reports` table |

---

## 11. Implementation Roadmap (each phase leaves the app fully functional)

**Phase 1 — Architecture (this document).** No code changes. Deliverable: this audit, reviewed and approved.

**Phase 2 — QMS Copilot (intents + flow, read-only).**
- Add `INTENT_TYPES` entries + classifier few-shot examples.
- Add `flows/qmsCopilotFlow.js` and `services/qmsReadinessService.js` (read-only composition of existing services).
- No new DB tables yet. No dashboard changes yet.
- Ships: `qmsReadiness`, `qmsGaps`, `qmsModerationLookup` via WhatsApp only.

**Phase 3 — Evidence Engine.**
- Data-volume check on `saved_resources.metadata` query patterns.
- If needed: add `qms_evidence_tags` (additive migration, §5), lazily populated.
- Wire `qmsGapCheck`'s "generate missing evidence" action back into `generationPipeline.js` with pre-filled context.

**Phase 4 — Observation Assistant.**
- `qmsPrepare` — pre-observation prep, composing existing `observationFlow`/lesson plan/assessment history for a class.
- Decision point: does this require a role model (HOD observing a teacher) — separate ADR if so.

**Phase 5 — Professional Growth.**
- New `prompts/personalGrowthPlan.js`, new `qmsGrowthPlan` intent, `reports.report_type='growthPlan'`.
- This is the first genuinely new *content-generation* surface in the roadmap — budget accordingly.

**Phase 6 — Portfolio Builder.**
- New PDF template in `pdfService.js` composing existing saved resources + reports + growth plan into one exportable document.

**Phase 7 — UI.**
- Dashboard `/qms` route and WhatsApp `QMS` command surfacing everything built in Phases 2–6.
- (Natural-language access already works from Phase 2 onward — Phase 7 is the discoverability/polish layer, not a functional dependency.)

---

## Appendix: Non-negotiables checklist (confirmed compliant with this design)

- ✅ No existing API/route/table/component renamed.
- ✅ No existing business logic modified.
- ✅ No WhatsApp workflow redesigned — QMS is additive intents in the same classifier and a new flow file, following the existing one-file-per-flow pattern.
- ✅ Every phase leaves the app fully functional (each phase's scope is additive-only; nothing in Phases 2–7 requires touching a file outside `flows/`, `services/`, `prompts/`, `routes/api.js` in an additive way, or `dashboard/src/pages/`).
- ⚠️ Two items flagged as requiring separate approval before design, not assumed here: (1) HOD/moderator role & sign-off model, (2) the honesty/authorship boundary for AI-assisted "Professional Reflection" content.