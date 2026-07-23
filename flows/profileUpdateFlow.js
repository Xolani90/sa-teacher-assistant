'use strict';

/**
 * Profile update conversation flow — extracted from routes/webhook.js.
 *
 * Scope: the multi-turn "update your profile" conversation.
 *   - ask_field step (choose which field: grade/subject/school/language)
 *   - ask_grade / ask_subject / ask_school / ask_language steps, each with
 *     its own CANCEL handling and validation via services/onboardingService
 *
 * Dependencies are injected via the `deps` object rather than required
 * directly, so this module has no reverse dependency on webhook.js and
 * no dependency on services/ beyond what's handed to it (other than the
 * onboardingService parsing helpers, which are pure functions required
 * directly, matching the original inline implementation).
 *
 * Expected deps shape:
 * {
 *   profileUpdateState,     // SessionStore instance (owned/instantiated in webhook.js)
 *   hashPhone,               // (from) => phoneHash
 *   safeSendMessage,         // async (from, text) => void
 *   updateTeacherProfile,    // (from, fields) => void
 *   gradeLabel,              // (grade) => string
 * }
 */

/**
 * Handles the multi-turn profile update conversation.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleProfileUpdateFlow(from, text, deps) {
  const {
    profileUpdateState,
    hashPhone,
    safeSendMessage,
    updateTeacherProfile,
    gradeLabel,
  } = deps;

  const phoneHash = hashPhone(from);
  const state = profileUpdateState.get(phoneHash);

  // Session TTL check (10 minutes)
  if (state && Date.now() - state.lastActivity > 10 * 60 * 1000) {
    profileUpdateState.delete(phoneHash);
    return false; // Treat as new session
  }

  // If not in profile update flow, return false
  if (!state) return false;

  const trimmed = text.trim();

  // Import parsing functions from onboardingService
  const { parseGradeInput, parseSubjectInput, parseSchoolInput, parseLanguageInput } = require('../services/onboardingService');

  // ask_field: parse 1-4, set step to the appropriate field name
  if (state.step === 'ask_field') {
    const choice = parseInt(trimmed, 10);
    if (choice < 1 || choice > 4) {
      await safeSendMessage(from, `Please reply with a number between 1 and 4:\n\n1. Grade\n2. Subject\n3. School\n4. Language`);
      return true;
    }

    const fieldMap = {
      1: 'ask_grade',
      2: 'ask_subject',
      3: 'ask_school',
      4: 'ask_language',
    };
    state.step = fieldMap[choice];
    state.lastActivity = Date.now();
    profileUpdateState.set(phoneHash, state);

    const prompts = {
      ask_grade: `Which grade do you mainly teach?\n\nReply with just the number, e.g.: *7* or *Grade 10*\n\n(You can always specify a different grade in any request)\n\nReply *CANCEL* to skip.`,
      ask_subject: `What subject do you mainly teach?\n\nExamples:\n• Mathematics\n• English\n• Life Sciences\n• Physical Sciences\n• History\n• Geography\n• Accounting\n• Business Studies\n\n(You can request any subject any time)\n\nReply *CANCEL* to skip.`,
      ask_school: `What school do you teach at?\n\nThis will appear on your PDF headers.\n\nReply with your school name, or type *cancel* to continue.`,
      ask_language: `Preferred language for generated content?\n\nReply with:\n• *1* for English\n• *2* for Afrikaans\n• *3* for isiZulu\n• *4* for isiXhosa\n• *5* for Sesotho\n• *6* for Setswana\n• *7* for Sepedi\n• *8* for Xitsonga\n• *9* for siSwati\n• *10* for Tshivenda\n• *11* for isiNdebele\n\nThis will apply to all worksheets, tests, lesson plans, and explanations you generate.\n\nReply *CANCEL* to skip.`,
    };
    await safeSendMessage(from, prompts[fieldMap[choice]]);
    return true;
  }

  // Handle each field update
  if (state.step === 'ask_grade') {
    if (trimmed.toUpperCase() === 'CANCEL') {
      profileUpdateState.delete(phoneHash);
      await safeSendMessage(from, `Profile update cancelled.`);
      return true;
    }
    const grade = parseGradeInput(trimmed);
    if (grade === null) {
      await safeSendMessage(from, `I didn't catch that. Let me have a grade number, e.g.:\n\n*7* or *Grade 10* or *Gr 4* or *Grade R*\n\nOr reply *CANCEL* to skip.`);
      return true;
    }
    updateTeacherProfile(from, { grade });
    profileUpdateState.delete(phoneHash);
    await safeSendMessage(from, `✅ Updated! Your grade is now set to ${gradeLabel(grade)}.`);
    return true;
  }

  if (state.step === 'ask_subject') {
    if (trimmed.toUpperCase() === 'CANCEL') {
      profileUpdateState.delete(phoneHash);
      await safeSendMessage(from, `Profile update cancelled.`);
      return true;
    }
    const subject = parseSubjectInput(trimmed);
    if (!subject) {
      await safeSendMessage(from, `I didn't recognise that subject. Let me try again with one of these:\n\n*Mathematics* | *English* | *Life Sciences* | *Physical Sciences* | *History* | *Geography* | *Accounting* | *Business Studies* | *Economics*\n\nOr reply *CANCEL* to skip.`);
      return true;
    }
    updateTeacherProfile(from, { subject });
    profileUpdateState.delete(phoneHash);
    await safeSendMessage(from, `✅ Updated! Your subject is now set to ${subject}.`);
    return true;
  }

  if (state.step === 'ask_school') {
    if (trimmed.toUpperCase() === 'CANCEL') {
      profileUpdateState.delete(phoneHash);
      await safeSendMessage(from, `Profile update cancelled.`);
      return true;
    }
    const school = parseSchoolInput(trimmed);
    if (!school) {
      await safeSendMessage(from, `I didn't catch that. Let me have your school name, or reply *cancel* to continue.`);
      return true;
    }
    updateTeacherProfile(from, { school });
    profileUpdateState.delete(phoneHash);
    await safeSendMessage(from, `✅ Updated! Your school is now set to ${school}.`);
    return true;
  }

  if (state.step === 'ask_language') {
    if (trimmed.toUpperCase() === 'CANCEL') {
      profileUpdateState.delete(phoneHash);
      await safeSendMessage(from, `Profile update cancelled.`);
      return true;
    }
    const language = parseLanguageInput(trimmed);
    if (!language) {
      await safeSendMessage(from, `Please reply with a number 1-11 for your preferred language:\n\n• 1 = English\n• 2 = Afrikaans\n• 3 = isiZulu\n• 4 = isiXhosa\n• 5 = Sesotho\n• 6 = Setswana\n• 7 = Sepedi\n• 8 = Xitsonga\n• 9 = siSwati\n• 10 = Tshivenda\n• 11 = isiNdebele\n\nOr reply *CANCEL* to skip.`);
      return true;
    }
    updateTeacherProfile(from, { language });
    profileUpdateState.delete(phoneHash);
    const languageDisplayNames = {
      english: 'English',
      afrikaans: 'Afrikaans',
      isizulu: 'isiZulu',
      isixhosa: 'isiXhosa',
      sesotho: 'Sesotho',
      setswana: 'Setswana',
      sepedi: 'Sepedi',
      xitsonga: 'Xitsonga',
      siswati: 'siSwati',
      tshivenda: 'Tshivenda',
      isindebele: 'isiNdebele',
    };
    await safeSendMessage(from, `✅ Updated! Your language is now set to ${languageDisplayNames[language] || language}.`);
    return true;
  }

  return false;
}

module.exports = { handleProfileUpdateFlow };
