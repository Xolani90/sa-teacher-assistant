'use strict';

/**
 * routes/api.js — ADR-007 PR10: Dashboard/API exposure.
 *
 * Third independent delivery surface for InterventionService's
 * InterventionPlan[], alongside flows/workspaceFlow.js's WhatsApp
 * `LEARNER PROGRESS <n>` command (PR8) and services/pdfService.js's
 * generateLearnerInterventionPdf() (PR9). Per the layering rule
 * documented in docs/ARCHITECTURE.md, this router does no mastery,
 * coverage, progress, or intervention computation of its own — it reads
 * getLearnerInterventionPlan()'s output verbatim and serializes it as
 * JSON. It does not call MasteryService, ProgressService, CoverageService,
 * or the timeline directly.
 *
 * Authorization: gated (at mount time, in server.js) by requireTeacherAuth
 * from utils/teacherAuth.js (ADR-008, PR17) — per-teacher JWT, superseding
 * the ADMIN_SECRET placeholder used through PR16. Per ADR-008 §5.1, no
 * service (getLearnerById, getLearnerInterventionPlan, etc.) is aware
 * that HTTP authentication exists; they keep taking a plain phoneHash /
 * learnerId exactly as before. This route is therefore also where
 * ownership is enforced: req.teacher.phoneHash (populated by the
 * middleware) is compared against learner.phoneHash before any plan data
 * is returned, so one teacher's JWT can never read another teacher's
 * learner data.
 *
 * One deliberate divergence from PR9's PDF behavior: generateLearnerInterventionPdf()
 * returns an error for a learner with zero InterventionPlans (an empty
 * PDF is not a useful artifact to hand a teacher). This endpoint instead
 * returns 200 with `plans: []` — the learner exists, there is just no
 * assessment/observation evidence yet, and a dashboard can render that
 * distinction ("no data yet" vs "learner not found") directly from the
 * response shape rather than parsing an error string.
 */

const express = require('express');
const router = express.Router();

/**
 * Builds the GET /learners/:learnerId/intervention-plan handler.
 *
 * Dependency-injected (matching flows/workspaceFlow.js's convention, PR8)
 * rather than requiring services/learnerRepository and
 * services/interventionService at module top level — this lets tests
 * stub `getLearnerById` / `getLearnerInterventionPlan` directly with
 * plain functions, no database or module-cache stubbing required, and
 * keeps this route file from silently growing a dependency on any
 * service beyond the two it's allowed to call.
 *
 * @param {Object} deps
 * @param {(learnerId:number) => Object|null} deps.getLearnerById
 * @param {(learnerId:number) => import('../services/interventionService').InterventionPlan[]} deps.getLearnerInterventionPlan
 * @returns {(req, res) => void}
 */
function createGetInterventionPlanHandler({ getLearnerById, getLearnerInterventionPlan }) {
  /**
   * GET /api/learners/:learnerId/intervention-plan
   *
   * @returns 400 if learnerId is not a positive integer
   * @returns 404 if no learner with that id exists, OR if the learner
   *          exists but belongs to a different teacher (ADR-008 §8 —
   *          identical response to "not found" so a caller can't use the
   *          response to probe which learner ids exist under other
   *          teachers)
   * @returns 200 { learnerId, plans: InterventionPlan[] } otherwise (plans
   *          may be an empty array if the learner has no evidence yet)
   */
  return function handleGetInterventionPlan(req, res) {
    const learnerId = Number(req.params.learnerId);

    if (!Number.isInteger(learnerId) || learnerId <= 0) {
      return res.status(400).json({ error: 'learnerId must be a positive integer.' });
    }

    let learner;
    try {
      learner = getLearnerById(learnerId);
    } catch (err) {
      console.error('[API] getLearnerById failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!learner) {
      return res.status(404).json({ error: 'Learner not found.' });
    }

    if (!req.teacher || learner.phoneHash !== req.teacher.phoneHash) {
      return res.status(404).json({ error: 'Learner not found.' });
    }

    let plans;
    try {
      plans = getLearnerInterventionPlan(learnerId);
    } catch (err) {
      console.error('[API] getLearnerInterventionPlan failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(200).json({
      learnerId,
      plans: plans || [],
    });
  };
}

/**
 * Builds the GET /resources handler (Feature 2, dashboard integration).
 *
 * Exposes services/teacherWorkspaceService.js's existing
 * getSavedResources(phoneHash, filters) — unchanged, no new
 * persistence/generation logic introduced here. This is the SAME table
 * (saved_resources) the WhatsApp SAVE command writes to
 * (core/commandHandler.js) and the SAME rows Feature 2's lesson-plan
 * homework grounding persists into — the dashboard reads the one
 * authoritative record, it never generates or stores a resource of its
 * own.
 *
 * List view intentionally omits `content` and `homework` (potentially
 * long free text) to keep the list payload light; the full body is
 * fetched per-resource via GET /resources/:id below when a teacher
 * opens one.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, filters:Object) => Object[]} deps.getSavedResources
 * @returns {(req, res) => void}
 */
function createGetResourcesHandler({ getSavedResources }) {
  /**
   * GET /api/resources?resourceType=&grade=&subject=
   *
   * @returns 200 { resources: [...] } — scoped to req.teacher.phoneHash;
   *          an empty array for a teacher with none, not an error
   * @returns 500 if the underlying service throws
   */
  return function handleGetResources(req, res) {
    const filters = {};
    if (typeof req.query.resourceType === 'string' && req.query.resourceType.trim() !== '') {
      filters.resourceType = req.query.resourceType;
    }
    if (req.query.grade !== undefined) {
      const g = Number(req.query.grade);
      if (Number.isInteger(g)) filters.grade = g;
    }
    if (typeof req.query.subject === 'string' && req.query.subject.trim() !== '') {
      filters.subject = req.query.subject;
    }

    let resources;
    try {
      resources = getSavedResources(req.teacher.phoneHash, filters);
    } catch (err) {
      console.error('[API] getSavedResources failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(200).json({
      resources: (resources || []).map((r) => ({
        id: r.id,
        resourceType: r.resource_type,
        title: r.title,
        grade: r.grade,
        subject: r.subject,
        topic: r.topic,
        createdAt: r.created_at,
      })),
    });
  };
}

/**
 * Parses a saved_resources row's `metadata` TEXT column (JSON, written by
 * services/teacherWorkspaceService.js#saveResource — see
 * core/commandHandler.js's SAVE handler for what it contains) back into
 * an object. Never throws: a malformed/legacy row (pre-dates a metadata
 * field, or predates Feature 2's `homework` key entirely) degrades to
 * `{}` rather than 500ing the whole request.
 *
 * @param {{ metadata?: string }} row
 * @returns {Object}
 */
function parseResourceMetadata(row) {
  if (!row || !row.metadata) return {};
  try {
    const parsed = JSON.parse(row.metadata);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Builds the GET /resources/:id handler (Feature 2, dashboard
 * integration) — single saved resource, including the full generated
 * content and, for a lesson plan, the exact homework text
 * core/generationPipeline.js persisted at generation time.
 *
 * Ownership: getSavedResource(resourceId, phoneHash) — see
 * services/teacherWorkspaceService.js — scopes BOTH the id and the
 * phone_hash in a single SQL WHERE clause, so a resourceId belonging to
 * a different teacher returns null exactly like a non-existent id does.
 * This handler returns an identical 404 for both cases (same convention
 * as every other ownership-scoped route in this file) — a caller can
 * never use the response to tell "wrong owner" apart from "doesn't
 * exist", and can never bypass ownership by any means, since the
 * teacher identity comes from req.teacher.phoneHash (populated by
 * requireTeacherAuth from the verified JWT), never from the request URL,
 * query, or body.
 *
 * `homework` here is read verbatim from metadata.homework — the same
 * string core/generationPipeline.js extracted and
 * core/commandHandler.js persisted at SAVE time. This handler performs
 * no generation, re-extraction, or AI call of any kind.
 *
 * @param {Object} deps
 * @param {(resourceId:number, phoneHash:string) => Object|null} deps.getSavedResource
 * @returns {(req, res) => void}
 */
function createGetResourceDetailHandler({ getSavedResource }) {
  /**
   * GET /api/resources/:id
   *
   * @returns 400 if :id is not a positive integer
   * @returns 404 if no resource with that id exists, OR it belongs to a
   *          different teacher (identical response either way)
   * @returns 200 the resource, including content/homework/metadata
   * @returns 500 if the underlying service throws
   */
  return function handleGetResourceDetail(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Resource id must be a positive integer.' });
    }

    let resource;
    try {
      resource = getSavedResource(id, req.teacher.phoneHash);
    } catch (err) {
      console.error('[API] getSavedResource failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!resource) {
      return res.status(404).json({ error: 'Resource not found.' });
    }

    const metadata = parseResourceMetadata(resource);

    return res.status(200).json({
      id: resource.id,
      resourceType: resource.resource_type,
      title: resource.title,
      content: resource.content,
      grade: resource.grade,
      subject: resource.subject,
      topic: resource.topic,
      term: metadata.term ?? null,
      atpTopic: metadata.atpTopic ?? null,
      // Feature 2: the exact persisted homework, verbatim — null for
      // every resource type other than lessonPlan, and null for a
      // lesson plan saved before Feature 2 shipped (no retroactive
      // backfill; those rows simply have no metadata.homework key).
      homework: metadata.homework ?? null,
      createdAt: resource.created_at,
    });
  };
}

/**
 * Builds the GET /classes handler (ADR-008, PR18).
 *
 * First teacher-facing API endpoint beyond the intervention-plan route.
 * Exposes services/teacherWorkspaceService.js's existing
 * getTeacherClasses(phoneHash) — unchanged, no new service/repository
 * behavior was introduced for this PR. The route does no aggregation,
 * filtering, or sorting of its own; getTeacherClasses() already returns
 * classes ordered by created_at DESC.
 *
 * Dependency-injected for the same reason as
 * createGetInterventionPlanHandler above: tests stub getTeacherClasses
 * directly, no database required.
 *
 * Uses learnerRosterService.getActiveRosterCounts(phoneHash) — NOT
 * classes.learner_count — for the learnerCount on each class.
 * classes.learner_count is a write-time cache (see
 * learnerRosterService.js's syncLearnerCount) that can drift from the
 * real roster: classes created via the legacy WhatsApp
 * "NEW CLASS <name> | <count>" flow store a declared capacity there and
 * never get a real `learners` row until a roster is actually captured.
 * The dashboard is a trust surface — a class card that says "34
 * learners" has to mean 34 rows exist, or clicking into it just looks
 * broken (see docs/ARCHITECTURE.md's Class Detail note on this). WhatsApp
 * flows that still read classes.learner_count directly (assessment
 * capture's slot count, "NEW CLASS" confirmation, etc.) are unaffected
 * by this change — that's a separate, intentional use of the same
 * column as a capture-time capacity, not a headcount.
 *
 * @param {Object} deps
 * @param {(phoneHash:string) => Object[]} deps.getTeacherClasses
 * @param {(phoneHash:string) => Map<number,number>} deps.getActiveRosterCounts
 * @returns {(req, res) => void}
 */
function createGetClassesHandler({ getTeacherClasses, getActiveRosterCounts }) {
  /**
   * GET /api/classes
   *
   * @returns 200 { classes: [...] } — scoped to req.teacher.phoneHash;
   *          an empty array for a teacher with no classes, not an error.
   *          learnerCount reflects the live, active roster
   *          (learners.removed_at IS NULL), not classes.learner_count.
   * @returns 500 if the underlying service throws
   */
  return function handleGetClasses(req, res) {
    let classes;
    let rosterCounts;
    try {
      classes = getTeacherClasses(req.teacher.phoneHash);
      rosterCounts = getActiveRosterCounts(req.teacher.phoneHash);
    } catch (err) {
      console.error('[API] getTeacherClasses failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(200).json({
      classes: (classes || []).map((c) => ({
        id: c.id,
        name: c.name,
        grade: c.grade,
        subject: c.subject,
        learnerCount: rosterCounts.get(c.id) || 0,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
    });
  };
}

/**
 * Builds the GET /learners handler (ADR-008, PR20).
 *
 * Exposes services/learnerRepository.js's existing
 * getTeacherLearners(phoneHash) — unchanged, no new repository/service
 * behavior was introduced for this PR (it already shipped in PR19).
 * The route does no joins, filtering, sorting, or reshaping beyond
 * returning the repository's rows verbatim; getTeacherLearners()
 * already returns camelCase fields scoped to the teacher and ordered
 * alphabetically by canonicalName, with phoneHash/removedAt excluded.
 *
 * Dependency-injected for the same reason as createGetClassesHandler
 * above: tests stub getTeacherLearners directly, no database required.
 *
 * @param {Object} deps
 * @param {(phoneHash:string) => Object[]} deps.getTeacherLearners
 * @returns {(req, res) => void}
 */
function createGetLearnersHandler({ getTeacherLearners }) {
  /**
   * GET /api/learners
   *
   * @returns 200 { learners: [...] } — scoped to req.teacher.phoneHash;
   *          an empty array for a teacher with no learners, not an error
   * @returns 500 if the underlying repository throws
   */
  return function handleGetLearners(req, res) {
    let learners;
    try {
      learners = getTeacherLearners(req.teacher.phoneHash);
    } catch (err) {
      console.error('[API] getTeacherLearners failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(200).json({
      learners: learners || [],
    });
  };
}

/**
 * Dependency-injected for the same reason as createGetLearnersHandler
 * above: tests stub getStatusSnapshot directly, no database required.
 *
 * @param {Object} deps
 * @param {(phoneHash:string) => Object} deps.getStatusSnapshot
 * @returns {(req, res) => void}
 */
function createGetTseStatusHandler({ getStatusSnapshot }) {
  /**
   * GET /api/tse/status
   *
   * @returns 200 { counts, latest, missingCategories } — scoped to
   *          req.teacher.phoneHash
   * @returns 500 if the underlying service throws
   */
  return function handleGetTseStatus(req, res) {
    let snapshot;
    try {
      snapshot = getStatusSnapshot(req.teacher.phoneHash);
    } catch (err) {
      console.error('[API] getStatusSnapshot failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    return res.status(200).json(snapshot);
  };
}

/**
 * Dependency-injected for the same reason as every other handler in
 * this file: tests stub listReflections directly, no database required.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, options?:Object) => Object[]} deps.listReflections
 * @returns {(req, res) => void}
 */
function createGetReflectionsHandler({ listReflections }) {
  /**
   * GET /api/reflections
   * Optional query param: ?term=<n> to scope to a single term, matching
   * listReflections()'s own { term } option (services/reflectionService.js).
   *
   * @returns 200 { reflections: [...] } — scoped to req.teacher.phoneHash,
   *          most recent first, excluding soft-deleted rows
   * @returns 500 if the underlying service throws
   */
  return function handleGetReflections(req, res) {
    const termParam = req.query.term;
    const term = termParam !== undefined ? Number(termParam) : null;

    let reflections;
    try {
      reflections = listReflections(req.teacher.phoneHash, { term });
    } catch (err) {
      console.error('[API] listReflections failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    return res.status(200).json({ reflections: reflections || [] });
  };
}

/**
 * Builds the POST /reflections handler — thin wrapper around
 * reflectionService.createReflection(phoneHash, params). No new
 * business logic: validation (empty content, non-array
 * evidenceLinkIds) already lives in the service and is surfaced here
 * as a 400, matching the service's own thrown Error messages.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, params:Object) => Object} deps.createReflection
 * @returns {(req, res) => void}
 */
function createPostReflectionHandler({ createReflection }) {
  /**
   * POST /api/reflections
   * Body: { content, term?, aiAssisted?, evidenceLinkIds?, topicId? }
   *
   * @returns 201 { reflection } on success
   * @returns 400 if content is missing/blank or evidenceLinkIds isn't an array
   * @returns 500 if the underlying service throws for any other reason
   */
  return function handlePostReflection(req, res) {
    const { content, term, aiAssisted, evidenceLinkIds, topicId } = req.body || {};

    let reflection;
    try {
      reflection = createReflection(req.teacher.phoneHash, { content, term, aiAssisted, evidenceLinkIds, topicId });
    } catch (err) {
      // createReflection's own guard clauses (missing content, bad
      // evidenceLinkIds shape) are caller-input errors, not server
      // failures — distinguish by message prefix rather than adding a
      // second validation layer here.
      if (/^createReflection:/.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[API] createReflection failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(201).json({ reflection });
  };
}

/**
 * Builds the PATCH /reflections/:id handler — thin wrapper around
 * reflectionService.updateReflection(phoneHash, id, params).
 *
 * @param {Object} deps
 * @param {(phoneHash:string, id:number, params:Object) => Object|null} deps.updateReflection
 * @returns {(req, res) => void}
 */
function createPatchReflectionHandler({ updateReflection }) {
  /**
   * PATCH /api/reflections/:id
   * Body: any subset of { content, aiAssisted, evidenceLinkIds }
   *
   * @returns 200 { reflection } on success
   * @returns 400 for a non-positive-integer :id, or empty content
   * @returns 404 if the reflection doesn't exist, isn't owned by this
   *          teacher, or is already soft-deleted (service returns null
   *          for all three — no existence oracle, same convention as
   *          the intervention-plan route)
   * @returns 500 if the underlying service throws for any other reason
   */
  return function handlePatchReflection(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid reflection id' });
    }

    const { content, aiAssisted, evidenceLinkIds } = req.body || {};

    let reflection;
    try {
      reflection = updateReflection(req.teacher.phoneHash, id, { content, aiAssisted, evidenceLinkIds });
    } catch (err) {
      if (/^updateReflection:/.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[API] updateReflection failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!reflection) {
      return res.status(404).json({ error: 'Reflection not found' });
    }

    return res.status(200).json({ reflection });
  };
}

/**
 * Builds the DELETE /reflections/:id handler — thin wrapper around
 * reflectionService.deleteReflection(phoneHash, id) (soft delete,
 * ADR-011 §7 — never a hard DELETE).
 *
 * @param {Object} deps
 * @param {(phoneHash:string, id:number) => boolean} deps.deleteReflection
 * @returns {(req, res) => void}
 */
function createDeleteReflectionHandler({ deleteReflection }) {
  /**
   * DELETE /api/reflections/:id
   *
   * @returns 204 on success (no body)
   * @returns 400 for a non-positive-integer :id
   * @returns 404 if the reflection doesn't exist, isn't owned by this
   *          teacher, or is already soft-deleted
   * @returns 500 if the underlying service throws
   */
  return function handleDeleteReflection(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid reflection id' });
    }

    let deleted;
    try {
      deleted = deleteReflection(req.teacher.phoneHash, id);
    } catch (err) {
      console.error('[API] deleteReflection failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!deleted) {
      return res.status(404).json({ error: 'Reflection not found' });
    }

    return res.status(204).send();
  };
}

/**
 * Assessment Blueprint routes (ADR-005 §5, Migration 029) — additive
 * Dashboard READ surface over the pre-existing services/blueprintRepository.js,
 * the SAME repository flows/blueprintAuthoringFlow.js's WhatsApp blueprint-
 * authoring flow writes to. No new persistence, no new weighting
 * calculation — this exposes the canonical persisted blueprint + its
 * already-computed weighting allocation exactly as stored. Mirrors the
 * growth-plans handlers below (dependency injection, no-existence-oracle
 * 404 convention) for both routes.
 *
 * listBlueprints(phoneHash, filters) already scopes by phone_hash inside
 * the repository. getBlueprintById(blueprintId) does not take a
 * phoneHash (it has no per-teacher variant), so ownership is checked
 * here at the route layer using the phoneHash already present on the
 * mapped blueprint object, and a mismatch is reported as 404 — not 403 —
 * to avoid leaking whether a given id exists to a non-owning teacher,
 * matching the existing convention on every other detail route.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, filters?:Object) => Object[]} deps.listBlueprints
 * @returns {(req, res) => void}
 */
function createGetBlueprintsHandler({ listBlueprints }) {
  /**
   * GET /api/blueprints
   * Optional query params: ?subject=<subject>, ?grade=<n>, ?status=<status>,
   * matching listBlueprints()'s own filters.
   *
   * @returns 200 { blueprints: [...] } — scoped to req.teacher.phoneHash,
   *          most recently updated first, excluding archived by default
   * @returns 500 if the underlying repository throws
   */
  return function handleGetBlueprints(req, res) {
    const subject = req.query.subject !== undefined ? req.query.subject : null;
    const gradeParam = req.query.grade;
    const grade = gradeParam !== undefined ? Number(gradeParam) : null;
    const status = req.query.status !== undefined ? req.query.status : null;

    let blueprints;
    try {
      blueprints = listBlueprints(req.teacher.phoneHash, {
        subject: subject || undefined,
        grade: grade != null ? grade : undefined,
        status: status || undefined,
      });
    } catch (err) {
      console.error('[API] listBlueprints failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    return res.status(200).json({ blueprints: blueprints || [] });
  };
}

/**
 * Builds the GET /blueprints/:id handler — thin wrapper around
 * blueprintRepository.getBlueprintById(id), with an ownership check at
 * the route layer (see comment above).
 *
 * @param {Object} deps
 * @param {(id:number) => Object|null} deps.getBlueprintById
 * @returns {(req, res) => void}
 */
function createGetBlueprintDetailHandler({ getBlueprintById }) {
  /**
   * GET /api/blueprints/:id
   *
   * @returns 200 { blueprint } on success — full header + weighting
   *          allocation (blueprint.questions), exactly as persisted
   * @returns 400 for a non-positive-integer :id
   * @returns 404 if the blueprint doesn't exist or isn't owned by this
   *          teacher
   * @returns 500 if the underlying repository throws
   */
  return function handleGetBlueprintDetail(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid blueprint id' });
    }

    let blueprint;
    try {
      blueprint = getBlueprintById(id);
    } catch (err) {
      console.error('[API] getBlueprintById failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!blueprint || blueprint.phoneHash !== req.teacher.phoneHash) {
      return res.status(404).json({ error: 'Blueprint not found' });
    }

    return res.status(200).json({ blueprint });
  };
}

/**
 * Growth Plans routes (PR29/ADR-011 §2, topicId per PR32/ADR-013 §4.3) —
 * thin wrappers over the pre-existing services/growthPlanService.js,
 * the SAME service flows/growthPlanFlow.js's WhatsApp NEW GOAL flow
 * calls. Mirrors the reflections handlers above exactly (dependency
 * injection, no-existence-oracle 404 convention, soft-delete 204).
 * No new business logic and no second growth-plan storage model.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, options?:Object) => Object[]} deps.listGrowthPlans
 * @returns {(req, res) => void}
 */
function createGetGrowthPlansHandler({ listGrowthPlans }) {
  /**
   * GET /api/growth-plans
   * Optional query params: ?term=<n>, ?status=<status>, matching
   * listGrowthPlans()'s own { term, status } options.
   *
   * @returns 200 { growthPlans: [...] } — scoped to req.teacher.phoneHash,
   *          most recent first, excluding soft-deleted rows
   * @returns 500 if the underlying service throws
   */
  return function handleGetGrowthPlans(req, res) {
    const termParam = req.query.term;
    const term = termParam !== undefined ? Number(termParam) : null;
    const status = req.query.status !== undefined ? req.query.status : null;

    let growthPlans;
    try {
      growthPlans = listGrowthPlans(req.teacher.phoneHash, { term, status });
    } catch (err) {
      console.error('[API] listGrowthPlans failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    return res.status(200).json({ growthPlans: growthPlans || [] });
  };
}

/**
 * Builds the GET /growth-plans/:id handler — thin wrapper around
 * growthPlanService.getGrowthPlan(phoneHash, id).
 *
 * @param {Object} deps
 * @param {(phoneHash:string, id:number) => Object|null} deps.getGrowthPlan
 * @returns {(req, res) => void}
 */
function createGetGrowthPlanDetailHandler({ getGrowthPlan }) {
  /**
   * GET /api/growth-plans/:id
   *
   * @returns 200 { growthPlan } on success
   * @returns 400 for a non-positive-integer :id
   * @returns 404 if the growth plan doesn't exist, isn't owned by this
   *          teacher, or is already soft-deleted
   * @returns 500 if the underlying service throws
   */
  return function handleGetGrowthPlanDetail(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid growth plan id' });
    }

    let growthPlan;
    try {
      growthPlan = getGrowthPlan(req.teacher.phoneHash, id);
    } catch (err) {
      console.error('[API] getGrowthPlan failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!growthPlan) {
      return res.status(404).json({ error: 'Growth plan not found' });
    }

    return res.status(200).json({ growthPlan });
  };
}

/**
 * Builds the POST /growth-plans handler — thin wrapper around
 * growthPlanService.createGrowthPlan(phoneHash, params).
 *
 * @param {Object} deps
 * @param {(phoneHash:string, params:Object) => Object} deps.createGrowthPlan
 * @returns {(req, res) => void}
 */
function createPostGrowthPlanHandler({ createGrowthPlan }) {
  /**
   * POST /api/growth-plans
   * Body: { goalText, term?, topicId, status? }
   *
   * @returns 201 { growthPlan } on success
   * @returns 400 if goalText/topicId/status fail the service's own
   *          validation (missing goalText, invalid topicId, bad status)
   * @returns 500 if the underlying service throws for any other reason
   */
  return function handlePostGrowthPlan(req, res) {
    const { goalText, term, topicId, status } = req.body || {};

    let growthPlan;
    try {
      growthPlan = createGrowthPlan(req.teacher.phoneHash, { goalText, term, topicId, status });
    } catch (err) {
      if (/^createGrowthPlan:/.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[API] createGrowthPlan failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(201).json({ growthPlan });
  };
}

/**
 * Builds the PATCH /growth-plans/:id handler — thin wrapper around
 * growthPlanService.updateGrowthPlan(phoneHash, id, params). Supports
 * partial updates, so the dashboard can PATCH a status-only body for
 * the "mark complete" action without resubmitting goalText/topicId.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, id:number, params:Object) => Object|null} deps.updateGrowthPlan
 * @returns {(req, res) => void}
 */
function createPatchGrowthPlanHandler({ updateGrowthPlan }) {
  /**
   * PATCH /api/growth-plans/:id
   * Body: any subset of { goalText, topicId, status }
   *
   * @returns 200 { growthPlan } on success
   * @returns 400 for a non-positive-integer :id, or invalid goalText/topicId/status
   * @returns 404 if the growth plan doesn't exist, isn't owned by this
   *          teacher, or is already soft-deleted
   * @returns 500 if the underlying service throws for any other reason
   */
  return function handlePatchGrowthPlan(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid growth plan id' });
    }

    const { goalText, topicId, status } = req.body || {};

    let growthPlan;
    try {
      growthPlan = updateGrowthPlan(req.teacher.phoneHash, id, { goalText, topicId, status });
    } catch (err) {
      if (/^updateGrowthPlan:/.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[API] updateGrowthPlan failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!growthPlan) {
      return res.status(404).json({ error: 'Growth plan not found' });
    }

    return res.status(200).json({ growthPlan });
  };
}

/**
 * Builds the DELETE /growth-plans/:id handler — thin wrapper around
 * growthPlanService.deleteGrowthPlan(phoneHash, id) (soft delete,
 * ADR-011 §7 — never a hard DELETE).
 *
 * @param {Object} deps
 * @param {(phoneHash:string, id:number) => boolean} deps.deleteGrowthPlan
 * @returns {(req, res) => void}
 */
function createDeleteGrowthPlanHandler({ deleteGrowthPlan }) {
  /**
   * DELETE /api/growth-plans/:id
   *
   * @returns 204 on success (no body)
   * @returns 400 for a non-positive-integer :id
   * @returns 404 if the growth plan doesn't exist, isn't owned by this
   *          teacher, or is already soft-deleted
   * @returns 500 if the underlying service throws
   */
  return function handleDeleteGrowthPlan(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid growth plan id' });
    }

    let deleted;
    try {
      deleted = deleteGrowthPlan(req.teacher.phoneHash, id);
    } catch (err) {
      console.error('[API] deleteGrowthPlan failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!deleted) {
      return res.status(404).json({ error: 'Growth plan not found' });
    }

    return res.status(204).send();
  };
}

/**
 * @param {Object} deps
 * @param {() => Array<{id:string,label:string,description:string,order:number}>} deps.listTopicsOrdered
 * @returns {(req, res) => void}
 */
function createGetQmsTopicsHandler({ listTopicsOrdered }) {
  /**
   * GET /api/qms/topics
   * Read-only. Returns the active QMS topic taxonomy (ADR-013 §3/§4.2)
   * so the dashboard can render a topic selector without maintaining
   * its own copy of the list — utils/qmsTopics.js remains the sole
   * source of truth (see that file's header comment).
   *
   * @returns 200 { topics: [{ id, label }] } — ordered ascending by `order`
   */
  return function handleGetQmsTopics(req, res) {
    const topics = listTopicsOrdered().map(({ id, label }) => ({ id, label }));
    return res.status(200).json({ topics });
  };
}

/**
 * Builds the PATCH /classes/:classId handler (Phase 6 — class editing).
 *
 * services/teacherWorkspaceService.js#updateClass already existed, fully
 * implemented and ownership-scoped via getClass(classId, phoneHash), but
 * had zero callers anywhere in the app — a teacher who mistyped a class
 * name/grade/subject at creation had no way to fix it. This is the first
 * caller.
 *
 * Ownership is enforced the same way as every other :id route here: this
 * handler resolves the class via getClass(classId, phoneHash) first and
 * 404s before calling updateClass() if the class doesn't exist or belongs
 * to a different teacher (ADR-008 §8, identical response to "not found",
 * no existence oracle).
 *
 * learner_count is deliberately never accepted from this route — it's a
 * derived/roster-driven field, not something a teacher edits directly —
 * so it's excluded from the allowed PATCH surface even if a client sends
 * it.
 *
 * @param {Object} deps
 * @param {(classId:number, phoneHash:string, updates:Object) => Object} deps.updateClass
 * @param {(classId:number, phoneHash:string) => Object|null} deps.getClass
 * @returns {(req, res) => void}
 */
function createPatchClassHandler({ updateClass, getClass }) {
  /**
   * PATCH /api/classes/:classId
   * Body: any subset of { name, grade, subject }
   *
   * @returns 200 { class } on success
   * @returns 400 for a non-positive-integer :classId, an empty body, an
   *          empty-string name, a non-positive-integer grade, or an
   *          empty-string subject
   * @returns 404 if the class doesn't exist or isn't owned by this
   *          teacher (getClass returns null) — updateClass is never
   *          called in that case
   * @returns 500 if the underlying service throws
   */
  return function handlePatchClass(req, res) {
    const classId = Number(req.params.classId);
    if (!Number.isInteger(classId) || classId <= 0) {
      return res.status(400).json({ error: 'classId must be a positive integer.' });
    }

    const body = req.body || {};
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return res.status(400).json({ error: 'name must be a non-empty string.' });
      }
      updates.name = body.name;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'grade')) {
      const grade = body.grade;
      if (typeof grade !== 'number' || !Number.isInteger(grade) || grade <= 0) {
        return res.status(400).json({ error: 'grade must be a positive integer.' });
      }
      updates.grade = grade;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'subject')) {
      if (typeof body.subject !== 'string' || body.subject.trim() === '') {
        return res.status(400).json({ error: 'subject must be a non-empty string.' });
      }
      updates.subject = body.subject;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Provide at least one of name, grade, subject to update.' });
    }

    let existing;
    try {
      existing = getClass(classId, req.teacher.phoneHash);
    } catch (err) {
      console.error('[API] getClass failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!existing) {
      return res.status(404).json({ error: 'Class not found.' });
    }

    let updatedClass;
    try {
      updatedClass = updateClass(classId, req.teacher.phoneHash, updates);
    } catch (err) {
      console.error('[API] updateClass failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(200).json({ class: updatedClass });
  };
}

/**
 * Builds the DELETE /classes/:classId handler (Phase 6 continuation —
 * class deletion).
 *
 * services/teacherWorkspaceService.js#deleteClass already existed, fully
 * implemented, ownership-scoped, and default-class-reassignment-aware —
 * but had zero callers anywhere in the app, same pattern as
 * updateClass before this phase. A teacher who created a class in
 * error (wrong grade, duplicate) had no way to remove it.
 *
 * Ownership follows the same getClass-then-mutate convention as the
 * PATCH handler above: 404s before calling deleteClass() if the class
 * doesn't exist or belongs to a different teacher.
 *
 * deleteClass() itself refuses to delete a class that still has
 * learners, assessments, or observations linked to it (classes.id is
 * FK-referenced by those tables with foreign_keys enforcement ON, and
 * this app has no cascade/archival policy for wiping out a teacher's
 * roster or assessment history as a side effect of removing a class).
 * That guard error is distinguished by its `deleteClass:` prefix and
 * surfaced as 409 Conflict with the service's explanatory message,
 * rather than a raw 500.
 *
 * @param {Object} deps
 * @param {(classId:number, phoneHash:string) => boolean} deps.deleteClass
 * @param {(classId:number, phoneHash:string) => Object|null} deps.getClass
 * @returns {(req, res) => void}
 */
function createDeleteClassHandler({ deleteClass, getClass }) {
  /**
   * DELETE /api/classes/:classId
   *
   * @returns 204 on success (no body)
   * @returns 400 for a non-positive-integer :classId
   * @returns 404 if the class doesn't exist or isn't owned by this
   *          teacher (getClass returns null) — deleteClass is never
   *          called in that case
   * @returns 409 if the class still has learners, assessments, or
   *          observations linked to it
   * @returns 500 if the underlying service throws for any other reason
   */
  return function handleDeleteClass(req, res) {
    const classId = Number(req.params.classId);
    if (!Number.isInteger(classId) || classId <= 0) {
      return res.status(400).json({ error: 'classId must be a positive integer.' });
    }

    let existing;
    try {
      existing = getClass(classId, req.teacher.phoneHash);
    } catch (err) {
      console.error('[API] getClass failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!existing) {
      return res.status(404).json({ error: 'Class not found.' });
    }

    let deleted;
    try {
      deleted = deleteClass(classId, req.teacher.phoneHash);
    } catch (err) {
      if (/^deleteClass:/.test(err.message)) {
        return res.status(409).json({ error: err.message });
      }
      console.error('[API] deleteClass failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!deleted) {
      return res.status(404).json({ error: 'Class not found.' });
    }

    return res.status(204).send();
  };
}

/**
 * Builds the GET /classes/:classId/detail handler (dashboard "Class
 * Detail" / command-center view — PROJECT_STATUS.md's post-branding
 * milestone).
 *
 * Exposes services/classDetailService.js's getClassDetail(phoneHash,
 * classId), which composes five already-shipped reads (class summary,
 * roster, class history, curriculum coverage, class intervention plan)
 * into one payload. Same layering discipline as every other route
 * here: this handler does no aggregation of its own, only auth/shape
 * concerns (classId validation, 404 vs 500, req.teacher.phoneHash
 * scoping) — ownership enforcement lives inside getClassDetail() itself
 * via getClass(classId, phoneHash), the same pattern
 * teacherWorkspaceService.getClass() already uses elsewhere.
 *
 * Dependency-injected for the same reason as the handlers above: tests
 * stub getClassDetail directly, no database required.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, classId:number) => Object|null} deps.getClassDetail
 * @returns {(req, res) => void}
 */
function createGetClassDetailHandler({ getClassDetail }) {
  /**
   * GET /api/classes/:classId/detail
   *
   * @returns 400 if classId is not a positive integer
   * @returns 404 if no class with that id exists, OR if the class
   *          exists but belongs to a different teacher (ADR-008 §8 —
   *          identical response to "not found", same convention as the
   *          intervention-plan route above)
   * @returns 200 the full aggregated Class Detail payload
   * @returns 500 if the underlying service throws
   */
  return function handleGetClassDetail(req, res) {
    const classId = Number(req.params.classId);

    if (!Number.isInteger(classId) || classId <= 0) {
      return res.status(400).json({ error: 'classId must be a positive integer.' });
    }

    let detail;
    try {
      detail = getClassDetail(req.teacher.phoneHash, classId);
    } catch (err) {
      console.error('[API] getClassDetail failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!detail) {
      return res.status(404).json({ error: 'Class not found.' });
    }

    return res.status(200).json(detail);
  };
}

/**
 * Builds the GET /classes/:classId/snapshot handler (ADR-014, dashboard
 * class overview).
 *
 * Exposes services/classSnapshotService.js's getClassSnapshot(phoneHash,
 * classId, options, classInfo), which composes classAnalyticsService
 * (ADR-013), classInterventionService (ADR-009), and — currently always
 * "unavailable", per ADR-014 §3.4 — a qms section, into one
 * fault-isolated payload. Same layering discipline as every other route
 * here: this handler does no aggregation of its own, only auth/shape
 * concerns (classId validation, 404 vs 500, req.teacher.phoneHash
 * scoping).
 *
 * classSnapshotService has no direct classes-table access of its own
 * (see its JSDoc), so this handler resolves classInfo via
 * teacherWorkspaceService.getClass(classId, phoneHash) first — the same
 * ownership-scoped lookup getClassDetail() uses internally — and 404s
 * before calling getClassSnapshot() if the class doesn't exist or
 * belongs to a different teacher (ADR-008 §8, identical response to
 * "not found").
 *
 * Dependency-injected for the same reason as the handlers above: tests
 * stub getClassSnapshot / getClass directly, no database required.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, classId:number, options:Object, classInfo:Object) => Object} deps.getClassSnapshot
 * @param {(classId:number, phoneHash:string) => Object|null} deps.getClass
 * @returns {(req, res) => void}
 */
function createGetClassSnapshotHandler({ getClassSnapshot, getClass }) {
  /**
   * GET /api/classes/:classId/snapshot
   *
   * @returns 400 if classId is not a positive integer
   * @returns 404 if no class with that id exists, OR if the class
   *          exists but belongs to a different teacher (ADR-008 §8 —
   *          identical response to "not found", same convention as the
   *          detail route above)
   * @returns 200 the ClassSnapshot payload (ADR-014 §3.3) — individual
   *          sections may independently be "ok" | "error" | "unavailable";
   *          this endpoint itself only 500s if class ownership resolution
   *          throws, not if a child service inside the snapshot fails
   * @returns 500 if the underlying class lookup throws
   */
  return function handleGetClassSnapshot(req, res) {
    const classId = Number(req.params.classId);

    if (!Number.isInteger(classId) || classId <= 0) {
      return res.status(400).json({ error: 'classId must be a positive integer.' });
    }

    let classRecord;
    try {
      classRecord = getClass(classId, req.teacher.phoneHash);
    } catch (err) {
      console.error('[API] getClass failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!classRecord) {
      return res.status(404).json({ error: 'Class not found.' });
    }

    const options = {};
    if (typeof req.query.subject === 'string' && req.query.subject.trim() !== '') {
      options.subject = req.query.subject;
    }

    const snapshot = getClassSnapshot(
      req.teacher.phoneHash,
      classId,
      options,
      { name: classRecord.name }
    );

    return res.status(200).json(snapshot);
  };
}

/**
 * Builds the GET /learners/:learnerId/detail handler — learner-scoped
 * counterpart to createGetClassDetailHandler above. Exposes
 * services/learnerDetailService.js's getLearnerDetail(phoneHash,
 * learnerId), which composes existing reads (learner profile, class
 * name, assessment history, observation history, mastery, intervention
 * plan) into one payload. Same layering discipline as every other
 * handler here: this handler does no aggregation of its own, only
 * auth/shape concerns (learnerId validation, 404 vs 500) — ownership
 * enforcement lives inside getLearnerDetail() itself via the
 * learner.phoneHash comparison, the same pattern
 * createGetInterventionPlanHandler above already uses.
 *
 * Dependency-injected for the same reason as the handlers above: tests
 * stub getLearnerDetail directly, no database required.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, learnerId:number) => Object|null} deps.getLearnerDetail
 * @returns {(req, res) => void}
 */
function createGetLearnerDetailHandler({ getLearnerDetail }) {
  /**
   * GET /api/learners/:learnerId/detail
   *
   * @returns 400 if learnerId is not a positive integer
   * @returns 404 if no learner with that id exists, OR if the learner
   *          exists but belongs to a different teacher (identical
   *          response to "not found", same convention as every other
   *          ownership-scoped route in this file)
   * @returns 200 the full aggregated Learner Detail payload
   * @returns 500 if the underlying service throws
   */
  return function handleGetLearnerDetail(req, res) {
    const learnerId = Number(req.params.learnerId);

    if (!Number.isInteger(learnerId) || learnerId <= 0) {
      return res.status(400).json({ error: 'learnerId must be a positive integer.' });
    }

    let detail;
    try {
      detail = getLearnerDetail(req.teacher.phoneHash, learnerId);
    } catch (err) {
      console.error('[API] getLearnerDetail failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!detail) {
      return res.status(404).json({ error: 'Learner not found.' });
    }

    return res.status(200).json(detail);
  };
}

/**
 * Builds the GET /observations/:assessmentId handler — session-scoped
 * counterpart to createGetLearnerDetailHandler above. Exposes
 * services/observationDetailService.js's getObservationDetail(phoneHash,
 * assessmentId), which composes observationRepository's existing
 * getObservationAssessment() with its correction-lineage neighbors.
 * Same layering discipline as every other handler here: no aggregation
 * of its own, only auth/shape concerns — ownership enforcement lives
 * inside getObservationDetail() itself.
 *
 * Dependency-injected for the same reason as the handlers above: tests
 * stub getObservationDetail directly, no database required.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, assessmentId:number) => Object|null} deps.getObservationDetail
 * @returns {(req, res) => void}
 */
function createGetObservationDetailHandler({ getObservationDetail }) {
  /**
   * GET /api/observations/:assessmentId
   *
   * @returns 400 if assessmentId is not a positive integer
   * @returns 404 if no session with that id exists, OR if it belongs to
   *          a different teacher (identical response to "not found",
   *          same convention as every other ownership-scoped route)
   * @returns 200 the full aggregated Observation Detail payload
   * @returns 500 if the underlying service throws
   */
  return function handleGetObservationDetail(req, res) {
    const assessmentId = Number(req.params.assessmentId);

    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return res.status(400).json({ error: 'assessmentId must be a positive integer.' });
    }

    let detail;
    try {
      detail = getObservationDetail(req.teacher.phoneHash, assessmentId);
    } catch (err) {
      console.error('[API] getObservationDetail failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!detail) {
      return res.status(404).json({ error: 'Observation session not found.' });
    }

    return res.status(200).json(detail);
  };
}

/**
 * Builds the GET /assessments/:assessmentId/detail handler — the
 * evidence view behind a class/learner's overall percentage. Same
 * ownership-scoped, dependency-injected convention as
 * createGetObservationDetailHandler.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, assessmentId:number) => Object|null} deps.getAssessmentDetail
 * @returns {(req, res) => void}
 */
function createGetAssessmentDetailHandler({ getAssessmentDetail }) {
  /**
   * GET /api/assessments/:assessmentId/detail
   *
   * @returns 400 if assessmentId is not a positive integer
   * @returns 404 if no assessment with that id exists, OR if it belongs
   *          to a different teacher (identical response to "not found")
   * @returns 200 the full aggregated Assessment Detail payload
   * @returns 500 if the underlying service throws
   */
  return function handleGetAssessmentDetail(req, res) {
    const assessmentId = Number(req.params.assessmentId);

    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return res.status(400).json({ error: 'assessmentId must be a positive integer.' });
    }

    let detail;
    try {
      detail = getAssessmentDetail(req.teacher.phoneHash, assessmentId);
    } catch (err) {
      console.error('[API] getAssessmentDetail failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!detail) {
      return res.status(404).json({ error: 'Assessment not found.' });
    }
    return res.status(200).json(detail);
  };
}

/**
 * Builds the GET /observations handler — thin wrapper around
 * observationRepository.getObservationHistory(phoneHash, filters).
 * No service layer needed: getObservationHistory is already a
 * repository-level read with its own filtering, ownership scoping, and
 * test coverage (used today by learnerDetailService.js). This route
 * exposes the same call directly to the dashboard for the Observation
 * Workspace list/browse view.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, filters:Object) => Object[]} deps.getObservationHistory
 * @returns {(req, res) => void}
 */
function createGetObservationsHandler({ getObservationHistory }) {
  /**
   * GET /api/observations?grade=&subject=&learnerName=&includeSuperseded=&limit=
   *
   * @returns 200 { observations: [...] } — scoped to req.teacher.phoneHash;
   *          an empty array for a teacher with no observations, not an error
   * @returns 500 if the underlying service throws
   */
  return function handleGetObservations(req, res) {
    const filters = {
      grade: req.query.grade || undefined,
      subject: req.query.subject || undefined,
      learnerName: req.query.learnerName || undefined,
      includeSuperseded: req.query.includeSuperseded === 'true',
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    };

    let observations;
    try {
      observations = getObservationHistory(req.teacher.phoneHash, filters);
    } catch (err) {
      console.error('[API] getObservationHistory failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(200).json({ observations: observations || [] });
  };
}

/**
 * Builds the GET /assessments/:assessmentId/pdf handler. Generates the
 * Blueprint Assessment PDF on demand (not pre-generated/cached — same
 * on-demand convention as every other PDF route in this codebase, e.g.
 * assessmentSessionFlow's PRINT command) and returns a signed download
 * URL rather than the file bytes, matching buildPdfUrl()'s existing
 * contract (core/generationPipeline.js).
 *
 * Ownership is enforced the same way generateBlueprintAssessmentPdf()
 * itself looks up the assessment — by re-deriving it from the DB inside
 * the service call. This handler additionally re-checks phone_hash here
 * before generating anything, so a cross-teacher assessmentId never
 * reaches PDF generation at all.
 *
 * @param {Object} deps
 * @param {(phoneHash:string, assessmentId:number) => Object|null} deps.getAssessmentDetail
 * @param {(assessmentId:number) => Promise<{fileId:string, filename:string}|{error:string}>} deps.generateBlueprintAssessmentPdf
 * @param {(fileId:string) => string} deps.buildPdfUrl
 * @returns {(req, res) => void}
 */
function createGetAssessmentPdfHandler({ getAssessmentDetail, generateBlueprintAssessmentPdf, buildPdfUrl }) {
  /**
   * GET /api/assessments/:assessmentId/pdf
   *
   * @returns 400 if assessmentId is not a positive integer
   * @returns 404 if no assessment with that id exists, OR if it belongs
   *          to a different teacher
   * @returns 422 if the assessment isn't blueprint-backed, or the PDF
   *          generator otherwise reports a structured error (e.g. zero
   *          learner results) — this is a request that will never
   *          succeed as-is, not a transient server fault
   * @returns 200 { url, filename }
   * @returns 500 if the underlying service throws
   */
  return async function handleGetAssessmentPdf(req, res) {
    const assessmentId = Number(req.params.assessmentId);

    if (!Number.isInteger(assessmentId) || assessmentId <= 0) {
      return res.status(400).json({ error: 'assessmentId must be a positive integer.' });
    }

    let detail;
    try {
      detail = getAssessmentDetail(req.teacher.phoneHash, assessmentId);
    } catch (err) {
      console.error('[API] getAssessmentDetail failed (pdf route):', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!detail) {
      return res.status(404).json({ error: 'Assessment not found.' });
    }

    if (!detail.assessment.isBlueprintBacked) {
      return res.status(422).json({
        error: 'This assessment was not created from a Blueprint, so no PDF report is available.',
      });
    }

    let pdfResult;
    try {
      pdfResult = await generateBlueprintAssessmentPdf(assessmentId);
    } catch (err) {
      console.error('[API] generateBlueprintAssessmentPdf failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (pdfResult.error) {
      return res.status(422).json({ error: pdfResult.error });
    }

    return res.status(200).json({
      url: buildPdfUrl(pdfResult.fileId),
      filename: pdfResult.filename,
    });
  };
}

// Real wiring — the only place this file touches actual services.
const { getLearnerById, getTeacherLearners } = require('../services/learnerRepository');
const { getLearnerInterventionPlan } = require('../services/interventionService');
const { getTeacherClasses, getSavedResources, getSavedResource } = require('../services/teacherWorkspaceService');
const { getActiveRosterCounts } = require('../services/learnerRosterService');
const { getStatusSnapshot } = require('../services/tseEvidenceService');
const { listReflections, createReflection, updateReflection, deleteReflection } = require('../services/reflectionService');
const { listGrowthPlans, getGrowthPlan, createGrowthPlan, updateGrowthPlan, deleteGrowthPlan } = require('../services/growthPlanService');
const { listBlueprints, getBlueprintById } = require('../services/blueprintRepository');
const { getClassDetail } = require('../services/classDetailService');
const { getClassSnapshot } = require('../services/classSnapshotService');
const { getClass, updateClass, deleteClass } = require('../services/teacherWorkspaceService');
const { getLearnerDetail } = require('../services/learnerDetailService');
const { getObservationDetail } = require('../services/observationDetailService');
const { getObservationHistory } = require('../services/observationRepository');
const { getAssessmentDetail } = require('../services/assessmentDetailService');
const { generateBlueprintAssessmentPdf } = require('../services/pdfService');
const { buildPdfUrl } = require('../core/generationPipeline');
const { listTopicsOrdered } = require('../utils/qmsTopics');
const { createIncident, getIncident, listIncidents, updateIncident } = require('../services/incidentService');

/**
 * Feature 3 — Teacher Incident Book API. Same shape/conventions as the
 * reflections handlers above: thin wrappers over incidentService.js,
 * ownership always taken from req.teacher.phoneHash (never the body/
 * params), 400 for the service's own `createIncident:`/`updateIncident:`
 * validation errors, 404 (not 403) for wrong-owner or missing rows so a
 * teacher can't distinguish "not yours" from "doesn't exist" — same
 * no-existence-oracle convention as createPatchReflectionHandler above.
 */

/**
 * @param {Object} deps
 * @param {(phoneHash:string, filters?:Object) => Object[]} deps.listIncidents
 * @returns {(req, res) => void}
 */
function createGetIncidentsHandler({ listIncidents }) {
  /**
   * GET /api/incidents
   * Optional query params: incidentType, fromDate, toDate — passed straight
   * through to incidentService.listIncidents' filters object.
   *
   * @returns 200 { incidents: [...] } scoped to req.teacher.phoneHash
   * @returns 500 if the underlying service throws
   */
  return function handleGetIncidents(req, res) {
    const { incidentType, fromDate, toDate } = req.query || {};

    let incidents;
    try {
      incidents = listIncidents(req.teacher.phoneHash, { incidentType, fromDate, toDate });
    } catch (err) {
      console.error('[API] listIncidents failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    return res.status(200).json({ incidents: incidents || [] });
  };
}

/**
 * @param {Object} deps
 * @param {(phoneHash:string, id:number) => Object|null} deps.getIncident
 * @returns {(req, res) => void}
 */
function createGetIncidentDetailHandler({ getIncident }) {
  /**
   * GET /api/incidents/:id
   *
   * @returns 200 { incident }
   * @returns 400 for a non-positive-integer :id
   * @returns 404 if the incident doesn't exist or isn't owned by this teacher
   * @returns 500 if the underlying service throws
   */
  return function handleGetIncidentDetail(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid incident id' });
    }

    let incident;
    try {
      incident = getIncident(req.teacher.phoneHash, id);
    } catch (err) {
      console.error('[API] getIncident failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    return res.status(200).json({ incident });
  };
}

/**
 * @param {Object} deps
 * @param {(phoneHash:string, params:Object) => Object} deps.createIncident
 * @returns {(req, res) => void}
 */
function createPostIncidentHandler({ createIncident }) {
  /**
   * POST /api/incidents
   * Body: { incidentDate, incidentTime, incidentType, description, actionTaken }
   * Any `teacherId`/`phoneHash` supplied in the body is ignored — ownership
   * always comes from req.teacher.phoneHash (the verified JWT subject).
   *
   * @returns 201 { incident } on success
   * @returns 400 for any of the service's own field-validation failures
   * @returns 500 if the underlying service throws for any other reason
   */
  return function handlePostIncident(req, res) {
    const { incidentDate, incidentTime, incidentType, description, actionTaken } = req.body || {};

    let incident;
    try {
      incident = createIncident(req.teacher.phoneHash, {
        incidentDate,
        incidentTime,
        incidentType,
        description,
        actionTaken,
      });
    } catch (err) {
      if (/^createIncident:/.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[API] createIncident failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    return res.status(201).json({ incident });
  };
}

/**
 * @param {Object} deps
 * @param {(phoneHash:string, id:number, params:Object) => Object|null} deps.updateIncident
 * @returns {(req, res) => void}
 */
function createPatchIncidentHandler({ updateIncident }) {
  /**
   * PATCH /api/incidents/:id
   * Body: any subset of { incidentDate, incidentTime, incidentType, description, actionTaken }
   *
   * @returns 200 { incident } on success
   * @returns 400 for a non-positive-integer :id, or a field-validation failure
   * @returns 404 if the incident doesn't exist or isn't owned by this teacher
   * @returns 500 if the underlying service throws for any other reason
   */
  return function handlePatchIncident(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid incident id' });
    }

    const { incidentDate, incidentTime, incidentType, description, actionTaken } = req.body || {};

    let incident;
    try {
      incident = updateIncident(req.teacher.phoneHash, id, {
        incidentDate,
        incidentTime,
        incidentType,
        description,
        actionTaken,
      });
    } catch (err) {
      if (/^updateIncident:/.test(err.message)) {
        return res.status(400).json({ error: err.message });
      }
      console.error('[API] updateIncident failed:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    return res.status(200).json({ incident });
  };
}

router.get(
  '/learners/:learnerId/intervention-plan',
  createGetInterventionPlanHandler({ getLearnerById, getLearnerInterventionPlan })
);

router.get(
  '/classes',
  createGetClassesHandler({ getTeacherClasses, getActiveRosterCounts })
);

router.get(
  '/resources',
  createGetResourcesHandler({ getSavedResources })
);
router.get(
  '/resources/:id',
  createGetResourceDetailHandler({ getSavedResource })
);

router.patch(
  '/classes/:classId',
  createPatchClassHandler({ updateClass, getClass })
);

router.delete(
  '/classes/:classId',
  createDeleteClassHandler({ deleteClass, getClass })
);

router.get(
  '/classes/:classId/detail',
  createGetClassDetailHandler({ getClassDetail })
);

router.get(
  '/classes/:classId/snapshot',
  createGetClassSnapshotHandler({ getClassSnapshot, getClass })
);

router.get(
  '/learners/:learnerId/detail',
  createGetLearnerDetailHandler({ getLearnerDetail })
);

router.get(
  '/observations',
  createGetObservationsHandler({ getObservationHistory })
);
router.get(
  '/observations/:assessmentId',
  createGetObservationDetailHandler({ getObservationDetail })
);

router.get(
  '/assessments/:assessmentId/detail',
  createGetAssessmentDetailHandler({ getAssessmentDetail })
);
router.get(
  '/assessments/:assessmentId/pdf',
  createGetAssessmentPdfHandler({ getAssessmentDetail, generateBlueprintAssessmentPdf, buildPdfUrl })
);

router.get(
  '/learners',
  createGetLearnersHandler({ getTeacherLearners })
);
router.get(
  '/tse/status',
  createGetTseStatusHandler({ getStatusSnapshot })
);

router.get(
  '/reflections',
  createGetReflectionsHandler({ listReflections })
);
router.post(
  '/reflections',
  createPostReflectionHandler({ createReflection })
);
router.patch(
  '/reflections/:id',
  createPatchReflectionHandler({ updateReflection })
);
router.delete(
  '/reflections/:id',
  createDeleteReflectionHandler({ deleteReflection })
);

router.get(
  '/growth-plans',
  createGetGrowthPlansHandler({ listGrowthPlans })
);
router.get(
  '/growth-plans/:id',
  createGetGrowthPlanDetailHandler({ getGrowthPlan })
);
router.post(
  '/growth-plans',
  createPostGrowthPlanHandler({ createGrowthPlan })
);
router.patch(
  '/growth-plans/:id',
  createPatchGrowthPlanHandler({ updateGrowthPlan })
);
router.delete(
  '/growth-plans/:id',
  createDeleteGrowthPlanHandler({ deleteGrowthPlan })
);

router.get(
  '/blueprints',
  createGetBlueprintsHandler({ listBlueprints })
);
router.get(
  '/blueprints/:id',
  createGetBlueprintDetailHandler({ getBlueprintById })
);

router.get(
  '/qms/topics',
  createGetQmsTopicsHandler({ listTopicsOrdered })
);

router.get(
  '/incidents',
  createGetIncidentsHandler({ listIncidents })
);
router.get(
  '/incidents/:id',
  createGetIncidentDetailHandler({ getIncident })
);
router.post(
  '/incidents',
  createPostIncidentHandler({ createIncident })
);
router.patch(
  '/incidents/:id',
  createPatchIncidentHandler({ updateIncident })
);

module.exports = router;
module.exports.__testExports = {
  createGetIncidentsHandler,
  createGetIncidentDetailHandler,
  createPostIncidentHandler,
  createPatchIncidentHandler,
  createGetInterventionPlanHandler,
  createGetClassesHandler,
  createPatchClassHandler,
  createDeleteClassHandler,
  createGetResourcesHandler,
  createGetResourceDetailHandler,
  createGetClassDetailHandler,
  createGetClassSnapshotHandler,
  createGetLearnerDetailHandler,
  createGetObservationDetailHandler,
  createGetObservationsHandler,
  createGetAssessmentDetailHandler,
  createGetAssessmentPdfHandler,
  createGetLearnersHandler,
  createGetTseStatusHandler,
  createGetReflectionsHandler,
  createPostReflectionHandler,
  createPatchReflectionHandler,
  createDeleteReflectionHandler,
  createGetGrowthPlansHandler,
  createGetGrowthPlanDetailHandler,
  createPostGrowthPlanHandler,
  createPatchGrowthPlanHandler,
  createDeleteGrowthPlanHandler,
  createGetQmsTopicsHandler,
  createGetBlueprintsHandler,
  createGetBlueprintDetailHandler,
};
