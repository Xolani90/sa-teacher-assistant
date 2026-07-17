'use strict';

/**
 * Worksheet conversation flow — extracted from routes/webhook.js.
 *
 * Scope: worksheet-specific CONVERSATION behavior only.
 *   - EASIER / HARDER / VISUAL / ORAL differentiation commands
 *   - lastWorksheetState bookkeeping (who last got a worksheet, with what
 *     intent snapshot, so a follow-up EASIER/HARDER/VISUAL/ORAL knows what
 *     to regenerate)
 *   - the "Need different versions?" nudge sent after a plain worksheet
 *     generation
 *
 * Explicitly OUT of scope (stays in routes/webhook.js / services/ until
 * core/generationPipeline.js exists):
 *   - AI generation (generateContent)
 *   - prompt building
 *   - quota tracking / rollbackUsage
 *   - PDF generation
 *   - SAVE lifecycle / resource persistence
 *
 * Dependencies are injected via the `deps` object rather than required
 * directly, so this module has no reverse dependency on webhook.js and
 * no dependency on services/ or core/ beyond what's handed to it.
 *
 * Expected deps shape:
 * {
 *   lastWorksheetState,   // SessionStore instance (owned/instantiated in webhook.js)
 *   safeSendMessage,      // async (from, text) => void
 *   hashPhone,            // (from) => phoneHash
 *   triggerGeneration,    // async (from, intent) => void — currently processGeneration(),
 *                         // will point at core/generationPipeline.js once it exists
 * }
 */

const DIFFERENTIATION_COMMANDS = {
  EASIER: 'easier',
  HARDER: 'harder',
  VISUAL: 'visual',
  ORAL: 'oral',
};

/**
 * Handles the EASIER / HARDER / VISUAL / ORAL follow-up commands that
 * regenerate the most recent worksheet with a different differentiation
 * mode applied.
 *
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleWorksheetFlow(from, text, deps) {
  const {
    lastWorksheetState,
    safeSendMessage,
    hashPhone,
    triggerGeneration,
  } = deps;

  const upper = text.toUpperCase().trim();
  const differentiation = DIFFERENTIATION_COMMANDS[upper];
  if (!differentiation) return false;

  const phoneHash = hashPhone(from);
  const lastWorksheet = lastWorksheetState.get(phoneHash);
  if (!lastWorksheet) {
    await safeSendMessage(from, `Send me a worksheet request first, then reply EASIER/HARDER/VISUAL/ORAL.`);
    return true;
  }

  const intent = { ...lastWorksheet.intent, type: 'worksheet', differentiation };
  await triggerGeneration(from, intent);
  return true;
}

/**
 * Records that a plain (non-differentiated) worksheet was just generated,
 * so a follow-up EASIER/HARDER/VISUAL/ORAL knows what to regenerate, and
 * sends the "Need different versions?" nudge.
 *
 * Called from processGeneration() in webhook.js immediately after a
 * worksheet is generated. This is the single owner of lastWorksheetState
 * writes — webhook.js no longer touches the store directly.
 *
 * @param {string} from
 * @param {object} intent   The intent used for this generation (topic/grade/subject read from it)
 * @param {string} content  The generated worksheet content, stored for reference
 * @param {object} deps
 */
function recordWorksheetGeneration(from, intent, content, deps) {
  const { lastWorksheetState, safeSendMessage, hashPhone } = deps;

  const phoneHash = hashPhone(from);
  lastWorksheetState.set(phoneHash, {
    intent: { topic: intent.topic, grade: intent.grade, subject: intent.subject },
    content: content,
    lastActivity: Date.now(),
  });

  setTimeout(async () => {
    await safeSendMessage(from,
      `🎯 Need different versions?\n\nReply EASIER — support version (more scaffolding)\n\nReply HARDER — extension version (higher challenge)\n\nReply VISUAL — diagram/image-based version\n\nReply ORAL — oral assessment questions`
    );
  }, 1000);
}

module.exports = {
  handleWorksheetFlow,
  recordWorksheetGeneration,
};
