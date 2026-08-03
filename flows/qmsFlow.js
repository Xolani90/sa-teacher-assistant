'use strict';

/**
 * QMS (Quality Management System) flow handler — read-only WhatsApp
 * commands over the qms_reflections / qms_growth_plans data (PR27-PR30,
 * ADR-011). Mirrors workspaceFlow.js's shape: stateless, single-message
 * commands, no session state, dependencies injected via `deps`.
 *
 * Commands:
 *   MY STATS       — quick summary (getSummary)
 *   MY STATS ALL   — summary + common focus areas across growth plans
 *   MY GOALS       — growth plan status counts + recent plans
 *   MY REFLECTIONS — recent reflection entries
 *   MY COACHING    — prescriptive recommendations (ADR-013 §6, PR33's
 *                    coachingEngineService.getCoachingInsights()).
 *                    Deliberately a standalone command, not folded into
 *                    MY STATS ALL — MY STATS/MY GOALS answer "what
 *                    happened / what am I committed to", MY COACHING
 *                    answers "what should I do next", which is a
 *                    distinct job (prescriptive vs descriptive) and
 *                    reads better as its own short WhatsApp message
 *                    than as a paragraph buried in a longer report.
 *
 * This flow does no aggregation of its own — every number shown here
 * comes straight from qmsAnalyticsService.js, reflectionService.js, or
 * coachingEngineService.js. Per ADR-007 §3.3's convention (already
 * followed by workspaceFlow.js's formatSubjectMastery/formatIntervention),
 * formatting helpers below read their inputs as-is and compute nothing.
 *
 * Expected deps shape:
 * {
 *   hashPhone,          // (from) => phoneHash
 *   getTeacherByPhone,  // (from) => teacher row | null
 *   safeSendMessage,    // async (from, text) => void
 *   getSummary,             // services/qmsAnalyticsService.js
 *   getGrowthPlanSummary,   // services/qmsAnalyticsService.js
 *   getCommonFocusAreas,    // services/qmsAnalyticsService.js
 *   listReflections,        // services/reflectionService.js
 *   getCurrentTerm,         // services/schoolCalendarRepository.js
 *   getCoachingInsights,    // services/coachingEngineService.js
 * }
 */

/**
 * Handles the QMS command group.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleQmsFlow(from, text, deps) {
  const {
    hashPhone,
    getTeacherByPhone,
    safeSendMessage,
    getSummary,
    getGrowthPlanSummary,
    getCommonFocusAreas,
    listReflections,
    getCurrentTerm,
    getCoachingInsights,
  } = deps;

  const upper = text.trim().toUpperCase();

  const isQmsCmd =
    upper === 'MY STATS' || upper === 'MY STATS ALL' ||
    upper === 'MY GOALS' ||
    upper === 'MY REFLECTIONS' ||
    upper === 'MY COACHING';

  if (!isQmsCmd) return false;

  const hash = hashPhone(from);
  const teacher = getTeacherByPhone(from);

  if (!teacher) {
    await safeSendMessage(from, `⚠️ You need to complete setup first. Reply *HELLO* to get started.`);
    return true;
  }

  // ── MY STATS / MY STATS ALL ──
  if (upper === 'MY STATS' || upper === 'MY STATS ALL') {
    const wantsAll = upper === 'MY STATS ALL';
    try {
      const summary = getSummary(hash);

      if (summary.reflectionCount === 0 && Object.keys(summary.growthPlanCountsByStatus).length === 0) {
        await safeSendMessage(from,
          `📋 *My QMS Stats*\n\nNo reflections or growth plans recorded yet.\n\nReply *REFLECT* to log a reflection, or *NEW GOAL* to start a growth plan.`
        );
        return true;
      }

      let msg = `📋 *My QMS Stats*\n\n`;
      msg += `📝 Reflections: ${summary.reflectionCount}\n`;

      const statusEntries = Object.entries(summary.growthPlanCountsByStatus);
      if (statusEntries.length > 0) {
        msg += `🎯 Growth plans: `;
        msg += statusEntries.map(([status, count]) => `${count} ${status}`).join(', ');
        msg += `\n`;
      } else {
        msg += `🎯 Growth plans: none yet\n`;
      }

      if (summary.latestActivity) {
        msg += `\n_Last activity: ${summary.latestActivity.split(' ')[0]}_`;
      }

      if (wantsAll) {
        const focusAreas = getCommonFocusAreas(hash);
        if (focusAreas.length > 0) {
          msg += `\n\n*Common focus areas*\n`;
          for (const area of focusAreas.slice(0, 5)) {
            msg += `• ${area.label} (${area.count})\n`;
          }
        }
      } else {
        msg += `\n\n_Reply *MY STATS ALL* for common focus areas too._`;
      }

      msg += `\n💡 _Reply *MY COACHING* for recommended next steps._`;

      await safeSendMessage(from, msg);
    } catch (err) {
      console.error('[QMS] MY STATS error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load your QMS stats. Please try again.`);
    }
    return true;
  }

  // ── MY GOALS ──
  if (upper === 'MY GOALS') {
    try {
      const { countsByStatus, recentPlans } = getGrowthPlanSummary(hash, { recentLimit: 5 });

      if (recentPlans.length === 0) {
        await safeSendMessage(from,
          `🎯 *My Growth Plans*\n\nYou haven't logged any growth plans yet.\n\nReply *NEW GOAL* to start one.`
        );
        return true;
      }

      let msg = `🎯 *My Growth Plans*\n\n`;
      const statusEntries = Object.entries(countsByStatus);
      msg += statusEntries.map(([status, count]) => `${count} ${status}`).join(', ') + `\n\n`;

      msg += `*Recent*\n`;
      for (const plan of recentPlans) {
        const area = plan.targetArea ? ` (${plan.targetArea})` : '';
        msg += `• ${plan.goalText}${area} — ${plan.status}\n`;
      }

      await safeSendMessage(from, msg);
    } catch (err) {
      console.error('[QMS] MY GOALS error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load your growth plans. Please try again.`);
    }
    return true;
  }

  // ── MY REFLECTIONS ──
  if (upper === 'MY REFLECTIONS') {
    try {
      const term = getCurrentTerm();
      const reflections = listReflections(hash, term != null ? { term } : {});

      if (reflections.length === 0) {
        await safeSendMessage(from,
          `📝 *My Reflections*\n\nNo reflections logged${term != null ? ` for Term ${term}` : ''} yet.\n\nReply *REFLECT* to log one.`
        );
        return true;
      }

      const recent = reflections.slice(0, 5);
      let msg = `📝 *My Reflections*${term != null ? ` — Term ${term}` : ''} (${reflections.length} total)\n\n`;
      for (const r of recent) {
        const date = r.createdAt ? r.createdAt.split(' ')[0] : '';
        const preview = r.content.length > 80 ? r.content.slice(0, 80) + '…' : r.content;
        msg += `• ${preview}\n  _${date}_\n\n`;
      }
      if (reflections.length > 5) {
        msg += `_...and ${reflections.length - 5} more._`;
      }

      await safeSendMessage(from, msg);
    } catch (err) {
      console.error('[QMS] MY REFLECTIONS error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load your reflections. Please try again.`);
    }
    return true;
  }

  // ── MY COACHING ──
  if (upper === 'MY COACHING') {
    try {
      const insights = getCoachingInsights(hash);

      if (insights.status === 'insufficient_data') {
        await safeSendMessage(from,
          `📘 *My Coaching*\n\nNot enough tagged reflections or growth plans yet to generate recommendations.\n\nReply *REFLECT* to log a reflection, or *NEW GOAL* to start a growth plan — recommendations appear once there's enough evidence.`
        );
        return true;
      }

      if (insights.recommendations.length === 0) {
        await safeSendMessage(from,
          `📘 *My Coaching*\n\n✅ No specific recommendations right now — nothing stands out as a recurring focus area.\n\nReply *MY STATS* to see your current numbers.`
        );
        return true;
      }

      let msg = `📘 *My Coaching*\n\n`;
      insights.recommendations.forEach((rec, i) => {
        msg += `*${i + 1}. ${rec.topicLabel}*\n`;
        msg += `Confidence: ${rec.confidenceLabel}\n`;
        msg += `${rec.recommendation}\n`;
        msg += `_${rec.explanation}_\n\n`;
      });
      msg += `_Reply *NEW GOAL* to turn a recommendation into a growth plan._`;

      await safeSendMessage(from, msg);
    } catch (err) {
      console.error('[QMS] MY COACHING error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load your coaching recommendations. Please try again.`);
    }
    return true;
  }

  return true;
}

module.exports = {
  handleQmsFlow,
};
