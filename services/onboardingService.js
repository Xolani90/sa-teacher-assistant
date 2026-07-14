'use strict';

const { getDb } = require('../utils/database');
const { hashPhone, updateTeacherProfile, getTeacherByPhone } = require('../utils/usageTracker');
const { parseGrade } = require('../utils/capsPhase');

// ── Onboarding steps ───────────────────────────────────────────────────────
// welcome → ask_name → ask_grade → ask_subject → done
//
// Once complete, the teacher's profile is used to pre-fill prompts so they
// don't have to specify grade/subject every time.

const STEPS = {
  WELCOME:      'welcome',
  ASK_NAME:     'ask_name',
  ASK_GRADE:    'ask_grade',
  ASK_SUBJECT:  'ask_subject',
  ASK_SCHOOL:   'ask_school',
  ASK_LANGUAGE: 'ask_language',
  DONE:         'done',
};

/**
 * Returns the current onboarding step for a teacher.
 * Returns 'done' if they've completed onboarding.
 *
 * @param {string} phoneHash
 * @returns {string} step name
 */
function getOnboardingStep(phoneHash) {
  const db = getDb();
  const row = db.prepare(`
    SELECT step FROM onboarding WHERE phone_hash = ?
  `).get(phoneHash);
  return row?.step || null; // null = no onboarding record = first visit
}

/**
 * Sets the current onboarding step.
 *
 * @param {string} phoneHash
 * @param {string} step
 */
function setOnboardingStep(phoneHash, step) {
  const db = getDb();
  db.prepare(`
    INSERT INTO onboarding (phone_hash, step, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(phone_hash) DO UPDATE
    SET step = excluded.step, updated_at = excluded.updated_at
  `).run(phoneHash, step);
}

/**
 * Checks if a teacher needs onboarding (new user OR incomplete profile).
 *
 * @param {string} phoneNumber
 * @returns {boolean}
 */
function needsOnboarding(phoneNumber) {
  const hash = hashPhone(phoneNumber);
  const step = getOnboardingStep(hash);
  return step === null || step !== STEPS.DONE;
}

/**
 * The main onboarding handler.
 * Called from the webhook BEFORE normal processing.
 *
 * Returns an object:
 * - { handled: true,  message: string } → send this message, don't process normally
 * - { handled: false }                  → onboarding complete, proceed normally
 *
 * @param {string} phoneNumber - Raw phone number
 * @param {string} messageText - Teacher's message
 * @returns {{ handled: boolean, message?: string }}
 */
function handleOnboarding(phoneNumber, messageText) {
  const hash = hashPhone(phoneNumber);
  const step = getOnboardingStep(hash);
  const text = messageText.trim();

  // ── Escape hatch: commands exit onboarding and process normally ─────────
  // If the user sends a command during onboarding, exit onboarding and let
  // the webhook process it as a normal request.
  const commands = ['PRO', 'STATUS', 'HELP', 'PROFILE'];
  const upperText = text.toUpperCase();
  if (commands.includes(upperText) && step !== null && step !== STEPS.DONE) {
    setOnboardingStep(hash, STEPS.DONE); // Exit onboarding
    return { handled: false }; // Let webhook process the command normally
  }

  // ── New user ───────────────────────────────────────────────────────────
  if (step === null) {
    setOnboardingStep(hash, STEPS.ASK_NAME);
    return {
      handled: true,
      message: buildWelcomeMessage(),
    };
  }

  // ── Collecting name ────────────────────────────────────────────────────
  if (step === STEPS.ASK_NAME) {
    const name = sanitiseName(text);
    if (!name) {
      return {
        handled: true,
        message: "What's your name? (First name is fine)",
      };
    }
    updateTeacherProfile(phoneNumber, { name });
    setOnboardingStep(hash, STEPS.ASK_GRADE);
    return {
      handled: true,
      message: buildAskGradeMessage(name),
    };
  }

  // ── Collecting grade ───────────────────────────────────────────────────
  if (step === STEPS.ASK_GRADE) {
    const grade = parseGradeInput(text);
    if (grade === null) {
      return {
        handled: true,
        message: "I didn't catch that — try just the number, like *7* or *Grade 10*. Or reply *SKIP* to skip.",
      };
    }
    if (grade !== 'SKIP') {
      updateTeacherProfile(phoneNumber, { grade });
    }
    setOnboardingStep(hash, STEPS.ASK_SUBJECT);
    return {
      handled: true,
      message: buildAskSubjectMessage(),
    };
  }

  // ── Collecting subject ─────────────────────────────────────────────────
  if (step === STEPS.ASK_SUBJECT) {
    const subject = parseSubjectInput(text);
    if (!subject) {
      return {
        handled: true,
        message: buildInvalidSubjectMessage(),
      };
    }
    if (subject !== 'SKIP') {
      updateTeacherProfile(phoneNumber, { subject });
    }
    setOnboardingStep(hash, STEPS.ASK_SCHOOL);
    return {
      handled: true,
      message: buildAskSchoolMessage(),
    };
  }

  // ── Collecting school ───────────────────────────────────────────────────
  if (step === STEPS.ASK_SCHOOL) {
    const school = parseSchoolInput(text);
    if (!school) {
      return {
        handled: true,
        message: "I didn't catch that — type your school name, or *skip* to continue.",
      };
    }
    if (school !== 'SKIP') {
      updateTeacherProfile(phoneNumber, { school });
    }
    setOnboardingStep(hash, STEPS.ASK_LANGUAGE);
    return {
      handled: true,
      message: buildAskLanguageMessage(),
    };
  }

  // ── Collecting language ─────────────────────────────────────────────────
  if (step === STEPS.ASK_LANGUAGE) {
    const language = parseLanguageInput(text);
    if (!language) {
      return {
        handled: true,
        message: "Just reply with a number from 1–11:\n\n1 = English · 2 = Afrikaans · 3 = isiZulu · 4 = isiXhosa · 5 = Sesotho\n6 = Setswana · 7 = Sepedi · 8 = Xitsonga · 9 = siSwati · 10 = Tshivenda · 11 = isiNdebele",
      };
    }
    updateTeacherProfile(phoneNumber, { language });
    setOnboardingStep(hash, STEPS.DONE);

    const teacher = getTeacherByPhone(phoneNumber);
    return {
      handled: true,
      message: buildOnboardingCompleteMessage(teacher),
    };
  }

  // Onboarding complete — normal processing
  return { handled: false };
}

// ── Message builders ───────────────────────────────────────────────────────

function buildWelcomeMessage() {
  return `Hey! 👋 I'm your SA Teacher Assistant — I help you create CAPS-aligned worksheets, tests, lesson plans, and more, right here on WhatsApp.

Quick question before we start: *what's your name?* (First name is fine)`;
}

function buildAskGradeMessage(name) {
  return `Nice to meet you, ${name}! 😊

*Which grade do you mainly teach?* Just the number is fine — e.g. *7* or *Grade 10*.

(You can always specify a different grade per request, so no pressure to get this perfect.)

Reply *SKIP* if you teach multiple grades.`;
}

function buildAskSubjectMessage() {
  return `Almost there!

*What subject do you mainly teach?*

E.g. Mathematics, English, Life Sciences, History, Geography, Accounting — anything works.

Reply *SKIP* if you cover multiple subjects.`;
}

function buildAskSchoolMessage() {
  return `Last one — *what school do you teach at?* This goes on your PDF headers.

Type your school name, or *skip* to leave it blank for now.`;
}

function buildAskLanguageMessage() {
  return `*Which language do you want your content in?* Reply with a number:

1 = English · 2 = Afrikaans · 3 = isiZulu · 4 = isiXhosa · 5 = Sesotho
6 = Setswana · 7 = Sepedi · 8 = Xitsonga · 9 = siSwati · 10 = Tshivenda · 11 = isiNdebele`;
}

function buildInvalidSubjectMessage() {
  return `Hmm, I didn't catch that one. Try something like Mathematics, English, Life Sciences, History, Geography, or Accounting.

Or just reply *SKIP* to move on.`;
}

function buildOnboardingCompleteMessage(teacher) {
  const name    = teacher?.name    ? `, ${teacher.name}` : '';
  const grade   = teacher?.grade   ? `\n📚 Grade ${teacher.grade}` : '';
  const subject = teacher?.subject ? `\n✏️ ${teacher.subject}` : '';

  return `All set${name}!${grade}${subject}

You've got *${process.env.FREE_LIMIT || 10} free generations* this month. Just type what you need — for example:

"Grade 7 Maths worksheet on fractions"
"20-mark test on photosynthesis"
"Lesson plan Grade 9 English poetry"

Reply *PRO* anytime to go unlimited (R${process.env.PRO_PRICE_ZAR || 99}/month). What can I make for you? 🚀`;
}

// ── Input parsers ──────────────────────────────────────────────────────────

function sanitiseName(text) {
  // Accept 2–40 character names, letters and spaces only
  const name = text.replace(/[^a-zA-Z\s]/g, '').trim();
  return (name.length >= 2 && name.length <= 40) ? name : null;
}

function parseGradeInput(text) {
  if (/^skip$/i.test(text.trim())) return 'SKIP';
  const trimmed = text.trim();
  // Bare "R" during onboarding means Grade R.
  if (/^r$/i.test(trimmed)) return 0;
  // Bare number during onboarding (e.g. just "7"), no "grade"/"gr" prefix required.
  const bareNum = trimmed.match(/^(\d{1,2})$/);
  if (bareNum) {
    const num = parseInt(bareNum[1], 10);
    return (num >= 1 && num <= 12) ? num : null;
  }
  return parseGrade(trimmed); // handles "Grade 7", "Grade R", "Gr R", etc.
}

const VALID_SUBJECTS = [
  'mathematics', 'maths', 'math',
  'english', 'english home language', 'english fal', 'english hl',
  'afrikaans',
  'life sciences', 'biology',
  'physical sciences', 'physics', 'chemistry',
  'history',
  'geography', 'geo',
  'accounting', 'acc',
  'business studies', 'business',
  'economics', 'econ',
  'life orientation', 'lo',
  'arts and culture', 'art',
  'technology', 'tech',
  'ems', 'economic management sciences',
  'natural sciences', 'science',
  'social sciences',
  'skip',
];

const SUBJECT_NORMALISE = {
  'maths': 'Mathematics', 'math': 'Mathematics',
  'mathematics': 'Mathematics',
  'english': 'English', 'english home language': 'English HL', 'english fal': 'English FAL', 'english hl': 'English HL',
  'afrikaans': 'Afrikaans',
  'biology': 'Life Sciences', 'life sciences': 'Life Sciences',
  'physics': 'Physical Sciences', 'chemistry': 'Physical Sciences', 'physical sciences': 'Physical Sciences',
  'history': 'History',
  'geography': 'Geography', 'geo': 'Geography',
  'accounting': 'Accounting', 'acc': 'Accounting',
  'business studies': 'Business Studies', 'business': 'Business Studies',
  'economics': 'Economics', 'econ': 'Economics',
  'life orientation': 'Life Orientation', 'lo': 'Life Orientation',
  'arts and culture': 'Arts & Culture', 'art': 'Arts & Culture',
  'technology': 'Technology', 'tech': 'Technology',
  'ems': 'EMS', 'economic management sciences': 'EMS',
  'natural sciences': 'Natural Sciences', 'science': 'Natural Sciences',
  'social sciences': 'Social Sciences',
};

function parseSubjectInput(text) {
  if (/^skip$/i.test(text.trim())) return 'SKIP';
  const cleaned = text.toLowerCase().trim().replace(/[^a-z\s]/g, '');
  const tokens = cleaned.split(/\s+/).filter(t => t.length > 0);
  
  // Check each token against SUBJECT_NORMALISE
  for (const token of tokens) {
    if (SUBJECT_NORMALISE[token]) {
      return SUBJECT_NORMALISE[token];
    }
  }
  
  // Try the full cleaned string for multi-word subjects
  const fullCleaned = cleaned.replace(/\s+/g, ' ');
  if (SUBJECT_NORMALISE[fullCleaned]) {
    return SUBJECT_NORMALISE[fullCleaned];
  }
  
  return null;
}

function parseSchoolInput(text) {
  if (/^skip$/i.test(text.trim())) return 'SKIP';
  const school = text.trim();
  // Accept 2-100 character school names
  return (school.length >= 2 && school.length <= 100) ? school : null;
}

function parseLanguageInput(text) {
  const trimmed = text.trim();
  const languageMap = {
    '1': 'english',
    '2': 'afrikaans',
    '3': 'isizulu',
    '4': 'isixhosa',
    '5': 'sesotho',
    '6': 'setswana',
    '7': 'sepedi',
    '8': 'xitsonga',
    '9': 'siswati',
    '10': 'tshivenda',
    '11': 'isindebele',
  };
  return languageMap[trimmed] || null;
}

module.exports = { handleOnboarding, needsOnboarding, STEPS, parseGradeInput, parseSubjectInput, parseSchoolInput, parseLanguageInput };