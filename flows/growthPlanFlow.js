'use strict';

/**
 * Growth plan flow handler (PR29, ADR-011 §2/§7/§9).
 * Dependencies are injected via the `deps` object rather than required
 * directly, so this module has no reverse dependency on webhook.js —
 * same convention as reflectionFlow.js/observationFlow.js.
 *
 * Expected deps shape:
 * {
 *   growthPlanState,    // SessionStore instance
 *   safeSendMessage,    // async (from, text) => void
 *   parseIntent,        // (text) => intent
 *   hashPhone,          // (from) => phoneHash
 *   createGrowthPlan,   // (phoneHash, { goalText, term, targetArea, status }) => growthPlan
 *   getCurrentTerm,     // schoolCalendarRepository: () => number|null
 * }
 *
 * Scope note (PR29): create-only, matching ADR-011's frozen Migration
 * 038 schema exactly — goalText and targetArea are the only two
 * teacher-authored free-text fields collected here. No reflection_id
 * linkage step (deferred to a future ADR — see PR29 discussion), no
 * planned_actions/success_criteria/target_date fields (not in the
 * frozen schema), no history/edit/delete sub-flow (PR30/PR31
 * territory). New plans are always created with status 'active' —
 * status transitions happen elsewhere (growthPlanService.completeGrowthPlan()
 * etc.), not through this creation flow.
 *
 * Correction path: mirrors reflectionFlow.js — reaching reviewSummary
 * and replying NO does not restart the whole flow, it offers a
 * one-shot choice of which single field to redo (awaitingCorrectionChoice),
 * then returns straight back to reviewSummary with that field replaced.
 * Nothing is persisted until YES.
 */

const YES_RE = /^y(es)?$/i;
const NO_RE = /^n(o)?$/i;

/**
 * Builds the review summary message for the current collected fields.
 *
 * @param {{goalText: string, targetArea: string}} fields
 * @returns {string}
 */
function buildReviewSummaryMessage({ goalText, targetArea }) {
  return (
    `Here's your growth plan:\n\n` +
    `*Goal:*\n${goalText}\n\n` +
    `*Focus area:*\n${targetArea}\n\n` +
    `Save this growth plan? Reply *YES* or *NO*, or *CANCEL* to discard.`
  );
}

// ── Growth plan flow handler ────────────────────────────────────────────
/**
 * Handles the "create growth plan" conversation. Collects two fixed
 * free-text fields across two separate messages (goal, focus area),
 * shows the teacher a summary of exactly what will be saved, and
 * persists only after they reply YES. Replying NO at the review step
 * offers a lightweight single-field correction before returning to
 * the review summary.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object|null} preClassifiedIntent
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleGrowthPlanFlow(from, text, preClassifiedIntent, deps) {
  const {
    growthPlanState,
    safeSendMessage,
    parseIntent,
    hashPhone,
    createGrowthPlan,
    getCurrentTerm,
  } = deps;

  const phoneHash = hashPhone(from);
  const state = growthPlanState.get(phoneHash);

  if (state && Date.now() - state.lastActivity > 30 * 60 * 1000) {
    growthPlanState.delete(phoneHash);
    return false;
  }

  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type !== 'growth_plan') return false;

    growthPlanState.set(phoneHash, {
      step: 'awaitingGoal',
      lastActivity: Date.now(),
    });
    await safeSendMessage(from,
      `🎯 *Create a Growth Plan*\n\nWhat's the goal you're working toward?`
    );
    return true;
  }

  const trimmed = text.trim();
  if (trimmed.toUpperCase() === 'CANCEL') {
    growthPlanState.delete(phoneHash);
    await safeSendMessage(from, `No problem — cancelled.`);
    return true;
  }

  if (state.step === 'awaitingGoal') {
    if (!trimmed) {
      growthPlanState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `Please send a short description of your goal, or *CANCEL* to stop.`
      );
      return true;
    }

    // Correction path: replace just this field, then go straight back
    // to reviewSummary instead of continuing the forward chain.
    if (state.correcting) {
      const fields = { goalText: trimmed, targetArea: state.targetArea };
      growthPlanState.set(phoneHash, {
        step: 'reviewSummary',
        ...fields,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `Updated summary:\n\n` + buildReviewSummaryMessage(fields));
      return true;
    }

    growthPlanState.set(phoneHash, {
      step: 'awaitingTargetArea',
      goalText: trimmed,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, `What area of your practice does this focus on?`);
    return true;
  }

  if (state.step === 'awaitingTargetArea') {
    if (!trimmed) {
      growthPlanState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `Please share the focus area, or *CANCEL* to stop.`
      );
      return true;
    }

    const fields = { goalText: state.goalText, targetArea: trimmed };
    growthPlanState.set(phoneHash, {
      step: 'reviewSummary',
      ...fields,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, buildReviewSummaryMessage(fields));
    return true;
  }

  if (state.step === 'reviewSummary') {
    if (YES_RE.test(trimmed)) {
      let term;
      try {
        term = getCurrentTerm();
      } catch (err) {
        console.error('[GrowthPlan] getCurrentTerm failed:', err.message);
        term = null;
      }

      if (term == null) {
        growthPlanState.delete(phoneHash);
        await safeSendMessage(from,
          `⚠️ *Couldn't determine the current school term, so this growth plan wasn't saved.* ` +
          `Please try again later, or contact support if this keeps happening.`
        );
        return true;
      }

      let saveError = null;
      try {
        createGrowthPlan(phoneHash, {
          goalText: state.goalText,
          term,
          targetArea: state.targetArea,
          status: 'active',
        });
      } catch (err) {
        saveError = err;
        console.error('[GrowthPlan] createGrowthPlan failed:', err.message);
      }

      growthPlanState.delete(phoneHash);

      if (saveError) {
        await safeSendMessage(from,
          `⚠️ *Couldn't save that growth plan right now.* Please try sending it again in a moment.`
        );
        return true;
      }

      await safeSendMessage(from, `✅ *Growth plan saved successfully.*`);
      return true;
    }

    if (NO_RE.test(trimmed)) {
      growthPlanState.set(phoneHash, {
        step: 'awaitingCorrectionChoice',
        goalText: state.goalText,
        targetArea: state.targetArea,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from,
        `Which part would you like to change?\n\n` +
        `1. Goal\n` +
        `2. Focus area\n` +
        `3. Cancel`
      );
      return true;
    }

    growthPlanState.set(phoneHash, { ...state, lastActivity: Date.now() });
    await safeSendMessage(from,
      `Reply *YES* to save this growth plan, *NO* to change something, or *CANCEL* to discard.`
    );
    return true;
  }

  if (state.step === 'awaitingCorrectionChoice') {
    if (trimmed === '3') {
      growthPlanState.delete(phoneHash);
      await safeSendMessage(from, `No problem — cancelled.`);
      return true;
    }

    if (trimmed === '1') {
      growthPlanState.set(phoneHash, {
        step: 'awaitingGoal',
        goalText: state.goalText,
        targetArea: state.targetArea,
        correcting: true,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `What's the goal you're working toward?`);
      return true;
    }

    if (trimmed === '2') {
      growthPlanState.set(phoneHash, {
        step: 'awaitingTargetArea',
        goalText: state.goalText,
        targetArea: state.targetArea,
        correcting: true,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `What area of your practice does this focus on?`);
      return true;
    }

    growthPlanState.set(phoneHash, { ...state, lastActivity: Date.now() });
    await safeSendMessage(from,
      `Please reply with a number:\n\n` +
      `1. Goal\n` +
      `2. Focus area\n` +
      `3. Cancel`
    );
    return true;
  }

  return false;
}

module.exports = {
  handleGrowthPlanFlow,
};
