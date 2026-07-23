'use strict';

/**
 * Parent message conversation flow — extracted from routes/webhook.js.
 *
 * Scope: the multi-turn "Parent Message Generator" conversation.
 *   - session entry via classified 'parentMessage' intent (situation
 *     detection + best-effort learner name extraction from the message)
 *   - ask_learner_name step when no name could be extracted up front
 *   - generate step (quota check, AI generation, rollback on failure)
 *   - post_generation step (handed off to FORMAL/TRANSLATE commands
 *     elsewhere; this flow just clears state on anything else)
 *   - ask_translation_language step (language validation, translation
 *     generation, rollback on failure)
 *
 * Dependencies are injected via the `deps` object rather than required
 * directly, so this module has no reverse dependency on webhook.js and
 * no dependency on services/ beyond what's handed to it.
 *
 * Expected deps shape:
 * {
 *   parentMessageState,      // SessionStore instance (owned/instantiated in webhook.js)
 *   hashPhone,                // (from) => phoneHash
 *   parseIntent,               // (text) => intent  — fallback classifier
 *   getTeacherByPhone,         // (from) => teacher row
 *   safeSendMessage,           // async (from, text) => void
 *   checkAndIncrementUsage,    // (from, kind) => { allowed, ... }
 *   rollbackUsage,             // (quota, from) => void
 *   buildPrompt,               // (spec, opts) => prompt
 *   generateContent,           // async (prompt, kind) => string
 *   FREE_LIMIT_DISPLAY,        // () => string
 * }
 */

/**
 * Handles the multi-turn parent message conversation.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object|null} preClassifiedIntent
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleParentMessageFlow(from, text, preClassifiedIntent = null, deps) {
  const {
    parentMessageState,
    hashPhone,
    parseIntent,
    getTeacherByPhone,
    safeSendMessage,
    checkAndIncrementUsage,
    rollbackUsage,
    buildPrompt,
    generateContent,
    FREE_LIMIT_DISPLAY,
  } = deps;

  const phoneHash = hashPhone(from);
  const state = parentMessageState.get(phoneHash);

  // Session TTL check (30 minutes)
  if (state && Date.now() - state.lastActivity > 30 * 60 * 1000) {
    parentMessageState.delete(phoneHash);
    return false; // Treat as new session
  }

  // If not in parent message flow, check if this is a parent message intent.
  // Uses the intent already classified once at the top of processMessage.
  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type === 'parentMessage') {
      const teacher = getTeacherByPhone(from);
      // Detect situation from the message
      const lower = text.toLowerCase();
      let situation = 'general';
      if (/\b(absent|absence|not attending|missing)\b/i.test(lower)) {
        situation = 'absence';
      } else if (/\b(failing|poor marks|struggling|not passing)\b/i.test(lower)) {
        situation = 'failing';
      } else if (/\b(behaviour|conduct|disrupting|disruptive)\b/i.test(lower)) {
        situation = 'behaviour';
      } else if (/\b(meeting|come in|appointment|see you)\b/i.test(lower)) {
        situation = 'meeting';
      } else if (/\b(outstanding work|homework|assignment|missing work)\b/i.test(lower)) {
        situation = 'outstanding_work';
      } else if (/\b(improvement|doing well|progress|great job)\b/i.test(lower)) {
        situation = 'improvement';
      }

      // Try to extract learner name from the message
      const nameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g);
      const learnerName = nameMatch ? nameMatch[0] : null;

      if (learnerName) {
        // Quota check before generating
        const quota = checkAndIncrementUsage(from, 'parentMessage');
        if (!quota.allowed) {
          await safeSendMessage(from,
            `You've hit your free limit (${FREE_LIMIT_DISPLAY()} generations/month). Reply *PRO* to keep going — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀`
          );
          return true;
        }
        // Generate immediately
        try {
          const prompt = buildPrompt({
            type: 'parentMessage',
            situation,
            learnerName,
            grade: teacher?.grade ?? null,
            subject: teacher?.subject || 'general',
            language: teacher?.language || 'english',
            teacherName: teacher?.name || null,
            school: teacher?.school || null,
          }, {});
          const content = await generateContent(prompt, 'parentMessage');
          await safeSendMessage(from, content);
          await safeSendMessage(from, `\n\n↩️ Reply FORMAL for a more formal letter version\n\n🌍 Reply TRANSLATE to get it in another language`);
          // Store for FORMAL/TRANSLATE commands
          parentMessageState.set(phoneHash, {
            step: 'post_generation',
            situation,
            learnerName,
            grade: teacher?.grade ?? null,
            subject: teacher?.subject || 'general',
            language: teacher?.language || 'english',
            teacherName: teacher?.name || null,
            school: teacher?.school || null,
            lastContent: content,
            lastActivity: Date.now(),
          });
        } catch (err) {
          console.error('[WEBHOOK] Quick parent message generation failed:', err.message);
          rollbackUsage(quota, from);
          await safeSendMessage(from, `❌ *Generation failed*\n\nSomething went wrong. Please try again.`);
        }
      } else {
        // Ask for learner name
        parentMessageState.set(phoneHash, {
          step: 'ask_learner_name',
          situation,
          grade: teacher?.grade ?? null,
          subject: teacher?.subject || 'general',
          language: teacher?.language || 'english',
          teacherName: teacher?.name || null,
          school: teacher?.school || null,
          lastActivity: Date.now(),
        });
        await safeSendMessage(from, `👨‍👩‍👧 *Parent Message Generator*\n\nWhat is the learner's name?`);
      }
      return true;
    }
    return false;
  }

  // Handle each step of the conversation
  const trimmed = text.trim();

  if (state.step === 'ask_learner_name') {
    if (trimmed.length < 2 || !/[a-zA-Z]/.test(trimmed)) {
      await safeSendMessage(from, "Let me have the learner's name (at least 2 characters):");
      return true;
    }
    state.learnerName = trimmed;
    state.step = 'generate';
    state.lastActivity = Date.now();
    parentMessageState.set(phoneHash, state);

    // Generate the message
    await safeSendMessage(from, `⏳ Generating parent message for ${trimmed}...`);

    const quota = checkAndIncrementUsage(from, 'parentMessage');
    if (!quota.allowed) {
      await safeSendMessage(from,
        `You've hit your free limit for the month (${FREE_LIMIT_DISPLAY()} generations). Reply *PRO* to go unlimited — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀\n\n` +
        `Your content is worth it — and so is your time. 🎓`
      );
      parentMessageState.delete(phoneHash);
      return true;
    }

    try {
      const prompt = buildPrompt({
        type: 'parentMessage',
        situation: state.situation,
        learnerName: state.learnerName,
        grade: state.grade,
        subject: state.subject,
        language: state.language,
        teacherName: state.teacherName,
        school: state.school,
      }, {});
      const content = await generateContent(prompt, 'parentMessage');
      await safeSendMessage(from, content);
      await safeSendMessage(from, `\n\n↩️ Reply FORMAL for a more formal letter version\n\n🌍 Reply TRANSLATE to get it in another language`);
      state.step = 'post_generation';
      state.lastContent = content;
      state.lastActivity = Date.now();
      parentMessageState.set(phoneHash, state);
    } catch (err) {
      console.error('[WEBHOOK] Parent message generation failed:', err.message);
      rollbackUsage(quota, from);
      await safeSendMessage(from, `❌ *Generation failed*\n\nSomething went wrong. Please try again.`);
      parentMessageState.delete(phoneHash);
    }
    return true;
  }

  if (state.step === 'post_generation') {
    // This step is handled by FORMAL and TRANSLATE commands in handleCommand
    // Just clear the state if they send something else
    parentMessageState.delete(phoneHash);
    return false;
  }

  if (state.step === 'ask_translation_language') {
    const language = trimmed.toLowerCase();
    const supportedLanguages = ['english', 'afrikaans', 'zulu', 'xhosa', 'sotho', 'tswana', 'sepedi', 'xitsonga', 'siswati', 'tshivenda', 'ndebele'];
    if (!supportedLanguages.includes(language)) {
      await safeSendMessage(from, `Please choose from: English, Afrikaans, Zulu, Xhosa, Sotho, Tswana, Sepedi, Xitsonga, Siswati, Tshivenda, or Ndebele.`);
      return true;
    }
    // Generate translation
    const translateQuota = checkAndIncrementUsage(from, 'parentMessage');
    if (!translateQuota.allowed) {
      await safeSendMessage(from,
        `You've hit your free limit (${FREE_LIMIT_DISPLAY()} generations/month). Reply *PRO* to keep going — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀`
      );
      parentMessageState.delete(phoneHash);
      return true;
    }
    await safeSendMessage(from, `⏳ Translating to ${language.charAt(0).toUpperCase() + language.slice(1)}...`);
    try {
      const prompt = buildPrompt({
        type: 'parentMessage',
        situation: state.situation,
        learnerName: state.learnerName,
        grade: state.grade,
        subject: state.subject,
        language: language,
        teacherName: state.teacherName,
        school: state.school,
        translateFrom: state.lastContent,
      }, {});
      const content = await generateContent(prompt, 'parentMessage');
      await safeSendMessage(from, content);
      parentMessageState.delete(phoneHash);
    } catch (err) {
      console.error('[WEBHOOK] Translation failed:', err.message);
      rollbackUsage(translateQuota, from);
      await safeSendMessage(from, `❌ *Translation failed*\n\nSomething went wrong. Please try again.`);
      parentMessageState.delete(phoneHash);
    }
    return true;
  }

  return false;
}

module.exports = { handleParentMessageFlow };
