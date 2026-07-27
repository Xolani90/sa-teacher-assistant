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

// Real wiring — the only place this file touches actual services.
const { getLearnerById } = require('../services/learnerRepository');
const { getLearnerInterventionPlan } = require('../services/interventionService');

router.get(
  '/learners/:learnerId/intervention-plan',
  createGetInterventionPlanHandler({ getLearnerById, getLearnerInterventionPlan })
);

module.exports = router;
module.exports.__testExports = { createGetInterventionPlanHandler };
