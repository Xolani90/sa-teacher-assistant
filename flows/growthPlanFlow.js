'use strict';

/**
 * Growth plan flow handler (PR29, ADR-011 §2/§7/§9; topic selection
 * added PR32, ADR-013 §5.2).
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
 *   createGrowthPlan,   // (phoneHash, { goalText, term, topicId, status }) => growthPlan
 *   getCurrentTerm,     // schoolCalendarRepository: () => number|null
 * }
 *
 * Scope note (PR29): create-only, matching ADR-011's frozen Migration
 * 038 schema. goalText is free text; topic (PR32, ADR-013) replaces
 * the original free-text targetArea field with a controlled taxonomy
 * selection via utils/qmsTopicSelection.js. No reflection_id linkage
 * step (deferred to a future ADR — see PR29 discussion), no
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
 *
 * State preservation (ADR-013 §5.2/§7.1): every *State.set(...) call
 * site in this file uses immutable spread updates ({ ...state, ... })
 * rather than explicit field lists, so the topicId field added in PR32
 * cannot be silently dropped by a transition that forgot to list it.
 */

const { renderTopicListMessage, resolveTopicSelection, labelForTopicId } = require('../utils/qmsTopicSelection');

// NavigationService migration (Navigation Platform §9 steps 2/4/5,
// mirroring ADR-019 Step 3 for Assessment): STATUS and CANCEL delegate
// to NavigationService's registered hooks (routes/webhook.js's growthPlan
// registerFlow() call) as the single authoritative execution path.
// Transitional fallback branches (kept during step 4 while the delegation
// was proven out) were removed once full regression confirmed safety —
// same sequencing Assessment's Commit 3b → Commit 4 followed. Deliberately
// NOT using navigationService.handleCancel() — it always attaches a
// YES-confirmation prompt, and growthPlan's CANCEL is immediate; adopting
// that prompt here would be a UX change, not an ownership migration.
const navigationService = require('../services/navigationService');

const YES_RE = /^y(es)?$/i;
const NO_RE = /^n(o)?$/i;

// ADR-019 Step 3 Commit 6 (Navigation Platform §9 step 6) — the
// awaitingCorrectionChoice 1/2/3 prompt now resolves its digit via
// NavigationService.consumeNumericReply() instead of local `trimmed === 'N'`
// checks, matching assessmentSessionFlow.js's COMPLETE_MENU_ID /
// COMPLETE_MENU_OPTIONS convention. openMenu() only stores state — it does
// not render or send anything — so the existing prompt text/safeSendMessage
// call sites are unchanged. State mutation (step transitions, `correcting:
// true`, deletion) stays owned by this flow; NavigationService only answers
// "which option was picked."
const CORRECTION_MENU_ID = 'growthPlan.correctionChoice';
const CORRECTION_MENU_OPTIONS = { '1': 'GOAL', '2': 'TOPIC', '3': 'CANCEL' };

function formatCorrectionChoiceMenu() {
  return `Which part would you like to change?\n\n1. Goal\n2. Topic\n3. Cancel`;
}

/**
 * Builds the review summary message for the current collected fields.
 *
 * @param {{goalText: string, topicId: string}} fields
 * @returns {string}
 */
function buildReviewSummaryMessage({ goalText, topicId }) {
  const topicLabel = labelForTopicId(topicId) || topicId;
  return (
    `Here's your growth plan:\n\n` +
    `*Goal:*\n${goalText}\n\n` +
    `*Topic:*\n${topicLabel}\n\n` +
    `Save this growth plan? Reply *YES* or *NO*, or *CANCEL* to discard.`
  );
}

// ── Growth plan flow handler ────────────────────────────────────────────
/**
 * Handles the "create growth plan" conversation. Collects a free-text
 * goal and a taxonomy topic selection across two separate messages,
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
  const upper = trimmed.toUpperCase();

  // ADR-019 Step 3 Commit 4 pattern, applied to growthPlan: STATUS/CANCEL
  // fully own the NavigationService path now — transitional fallbacks
  // removed once the delegation (previous commit) proved out under full
  // regression. Single authoritative execution path, no conditional
  // branches left over from the migration.
  if (upper === 'CANCEL') {
    navigationService.getFlowDefinition('growthPlan').hooks.cleanup(phoneHash);
    await safeSendMessage(from, `No problem — cancelled.`);
    return true;
  }

  if (upper === 'STATUS') {
    const message = navigationService
      .getFlowDefinition('growthPlan')
      .hooks.describeStatus(phoneHash);
    await safeSendMessage(from, message);
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
      const fields = { goalText: trimmed, topicId: state.topicId };
      growthPlanState.set(phoneHash, {
        ...state,
        step: 'reviewSummary',
        ...fields,
        correcting: false,
        lastActivity: Date.now(),
      });
      await safeSendMessage(from, `Updated summary:\n\n` + buildReviewSummaryMessage(fields));
      return true;
    }

    growthPlanState.set(phoneHash, {
      ...state,
      step: 'awaitingTopic',
      goalText: trimmed,
      lastActivity: Date.now(),
    });
    await safeSendMessage(from, renderTopicListMessage());
    return true;
  }

  if (state.step === 'awaitingTopic') {
    const selection = resolveTopicSelection(trimmed);
    if (!selection.ok) {
      growthPlanState.set(phoneHash, { ...state, lastActivity: Date.now() });
      await safeSendMessage(from,
        `Please reply with the number of a topic, or *CANCEL* to stop.\n\n` + renderTopicListMessage()
      );
      return true;
    }

    const fields = { goalText: state.goalText, topicId: selection.topicId };
    growthPlanState.set(phoneHash, {
      ...state,
      step: 'reviewSummary',
      ...fields,
      correcting: false,
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
          topicId: state.topicId,
          status: 'active',
        });
      } catch (err) {
        saveError = err;
        console.error('[GrowthPlan] createGrowthPlan failed:', err.message);
      }

      growthPlanState.set(phoneHash, { ...state, lastActivity: Date.now() });

      if (saveError) {
        await safeSendMessage(from,
          `⚠️ *Couldn't save that growth plan right now.* Nothing was lost — reply *YES* to try saving it again, or *CANCEL* to stop.`
        );
        return true;
      }

      growthPlanState.delete(phoneHash);
      await safeSendMessage(from, `✅ *Growth plan saved successfully.*`);
      return true;
    }

    if (NO_RE.test(trimmed)) {
      growthPlanState.set(phoneHash, {
        ...state,
        step: 'awaitingCorrectionChoice',
        lastActivity: Date.now(),
      });
      navigationService.openMenu(phoneHash, { id: CORRECTION_MENU_ID, options: CORRECTION_MENU_OPTIONS });
      await safeSendMessage(from, formatCorrectionChoiceMenu());
      return true;
    }

    growthPlanState.set(phoneHash, { ...state, lastActivity: Date.now() });
    await safeSendMessage(from,
      `Reply *YES* to save this growth plan, *NO* to change something, or *CANCEL* to discard.`
    );
    return true;
  }

  if (state.step === 'awaitingCorrectionChoice') {
    const consumed = navigationService.consumeNumericReply(phoneHash, trimmed);

    if (consumed.matched) {
      switch (consumed.value) {
        case 'CANCEL':
          growthPlanState.delete(phoneHash);
          await safeSendMessage(from, `No problem — cancelled.`);
          return true;

        case 'GOAL':
          growthPlanState.set(phoneHash, {
            ...state,
            step: 'awaitingGoal',
            correcting: true,
            lastActivity: Date.now(),
          });
          await safeSendMessage(from, `What's the goal you're working toward?`);
          return true;

        case 'TOPIC':
          growthPlanState.set(phoneHash, {
            ...state,
            step: 'awaitingTopic',
            correcting: true,
            lastActivity: Date.now(),
          });
          await safeSendMessage(from, renderTopicListMessage());
          return true;
      }
    }

    // Invalid/expired reply (unknown option, or no menu open at all —
    // e.g. after a process restart) — re-open the menu so the teacher
    // isn't stranded, then re-render the same fallback prompt as before.
    growthPlanState.set(phoneHash, { ...state, lastActivity: Date.now() });
    navigationService.openMenu(phoneHash, { id: CORRECTION_MENU_ID, options: CORRECTION_MENU_OPTIONS });
    await safeSendMessage(from,
      `Please reply with a number:\n\n` +
      `1. Goal\n` +
      `2. Topic\n` +
      `3. Cancel`
    );
    return true;
  }

  return false;
}

module.exports = {
  handleGrowthPlanFlow,
};
