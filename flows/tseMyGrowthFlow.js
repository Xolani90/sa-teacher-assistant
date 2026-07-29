'use strict';

/**
 * WhatsApp "MY GROWTH" command — teacher-facing view of the TSE Evidence
 * Engine snapshot (Migration 034, services/tseEvidenceService.js).
 * Read-only; getStatusSnapshot() is populated by tagEvidence() hooks
 * already wired into six write paths elsewhere in the codebase, plus
 * (Phase 4) the rule-based evidence-gap layer from
 * services/tseGrowthInsightService.js.
 */

const CATEGORY_LABELS = {
  curriculum: 'Curriculum Coverage',
  assessment: 'Assessments',
  intervention: 'Intervention Plans',
  observation: 'Observations',
  resource: 'Resources',
};

const CATEGORY_ORDER = ['curriculum', 'assessment', 'intervention', 'observation', 'resource'];

function statusLine(count) {
  if (count === 0) return 'none yet';
  if (count === 1) return '1 item';
  return `${count} items`;
}

function formatSnapshot(snapshot) {
  const lines = ['🌱 *MY GROWTH*', ''];
  for (const cat of CATEGORY_ORDER) {
    const label = CATEGORY_LABELS[cat];
    const count = snapshot.counts[cat] ?? 0;
    lines.push(`*${label}:* ${statusLine(count)}`);
  }

  // Phase 4: rule-based evidence-gap layer, when present. Absent/empty
  // on older snapshot shapes or if the insight layer failed, so every
  // line here is optional and degrades gracefully.
  if (snapshot.strength) {
    lines.push('', `✅ *Strength:* ${snapshot.strength}`);
  } else if (Array.isArray(snapshot.gaps) && snapshot.gaps.length > 0) {
    lines.push('', `⚠️ *Growth opportunity:* ${snapshot.gaps[0].message}`);
    if (snapshot.suggestedAction) {
      lines.push(`👉 *Suggested next step:* ${snapshot.suggestedAction}`);
    }
  }

  return lines.join('\n');
}

async function handleTseMyGrowthFlow(from, text, deps) {
  const trimmed = (text || '').trim();
  if (!/^my growth$/i.test(trimmed)) return false;

  const { hashPhone, getTeacherByPhone, safeSendMessage, getStatusSnapshot } = deps;
  const phoneHash = hashPhone(from);
  const teacher = getTeacherByPhone(phoneHash);

  if (!teacher) {
    await safeSendMessage(
      from,
      "You'll need to finish setup before I can show your growth snapshot. Send HI to get started."
    );
    return true;
  }

  try {
    const snapshot = getStatusSnapshot(phoneHash);
    await safeSendMessage(from, formatSnapshot(snapshot));
  } catch (err) {
    console.error('[TSE] MY GROWTH snapshot error:', err.message);
    await safeSendMessage(
      from,
      "I couldn't pull up your growth snapshot right now — please try again in a moment."
    );
  }

  return true;
}

module.exports = { handleTseMyGrowthFlow };
