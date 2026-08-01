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
const { getTeacherClasses } = require('../services/teacherWorkspaceService');
const { getActiveRosterCounts } = require('../services/learnerRosterService');
const { getStatusSnapshot } = require('../services/tseEvidenceService');
const { listReflections } = require('../services/reflectionService');
const { getClassDetail } = require('../services/classDetailService');
const { getClassSnapshot } = require('../services/classSnapshotService');
const { getClass } = require('../services/teacherWorkspaceService');
const { getLearnerDetail } = require('../services/learnerDetailService');
const { getObservationDetail } = require('../services/observationDetailService');
const { getAssessmentDetail } = require('../services/assessmentDetailService');
const { generateBlueprintAssessmentPdf } = require('../services/pdfService');
const { buildPdfUrl } = require('../core/generationPipeline');

router.get(
  '/learners/:learnerId/intervention-plan',
  createGetInterventionPlanHandler({ getLearnerById, getLearnerInterventionPlan })
);

router.get(
  '/classes',
  createGetClassesHandler({ getTeacherClasses, getActiveRosterCounts })
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

module.exports = router;
module.exports.__testExports = {
  createGetInterventionPlanHandler,
  createGetClassesHandler,
  createGetClassDetailHandler,
  createGetClassSnapshotHandler,
  createGetLearnerDetailHandler,
  createGetObservationDetailHandler,
  createGetAssessmentDetailHandler,
  createGetAssessmentPdfHandler,
  createGetLearnersHandler,
  createGetTseStatusHandler,
  createGetReflectionsHandler,
};
