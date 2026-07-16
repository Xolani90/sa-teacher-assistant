'use strict';

/**
 * AI-powered intent classifier.
 *
 * This replaces regex/keyword matching as the primary way the bot decides
 * what a teacher's message means. Instead of pattern-matching against fixed
 * phrases, it asks Claude to actually read the message — the same way a
 * knowledgeable colleague would — and infer intent, grade, subject, topic
 * and marks from context, profile defaults, typos, code-switching between
 * English and SA home languages, and indirect phrasing.
 *
 * CONTRACT: classifyIntent() always resolves to the exact same shape that
 * utils/intentParser.js's parseIntent() returns:
 *   { type, grade, subject, topic, marks, language }
 * This means every downstream consumer (processGeneration, the flow
 * handlers, the topic-ambiguity check, intentLabel, PDF generation) keeps
 * working completely unchanged — only the *understanding* step changes.
 *
 * RELIABILITY: if the AI call fails, times out, or returns malformed JSON,
 * this falls back to the deterministic regex parser automatically. A
 * teacher should never see a broken response just because a classification
 * call had a network hiccup.
 */

const { generateContent } = require('./aiService');
const { parseIntent: regexParseIntent, INTENT_TYPES } = require('../utils/intentParser');

const VALID_TYPES = Object.values(INTENT_TYPES);

const VALID_SUBJECTS = [
  'mathematics', 'physical sciences', 'natural sciences', 'life sciences',
  'english', 'history', 'geography', 'accounting', 'business studies',
  'economics', 'isizulu', 'isixhosa', 'afrikaans', 'sepedi', 'setswana',
  'tourism', 'cat', 'dramatic arts', 'visual arts', 'music',
  'agricultural sciences', 'consumer studies', 'hospitality studies',
  'civil technology', 'electrical technology', 'life orientation',
  'religion', 'physical education', 'general',
];

/**
 * Builds the classifier's system prompt. Deliberately short and strict —
 * this call needs to be fast and cheap (Haiku-class model), and the only
 * job is structured classification, not conversation or generation.
 *
 * @returns {string}
 */
function buildClassifierSystemPrompt() {
  return `You are the intent classifier for a WhatsApp bot used by South African (CAPS curriculum) teachers. You read one teacher message and decide what they want, the way an experienced colleague would — not by keyword spotting, but by actually understanding what's being asked, including typos, SMS-shorthand, code-switching between English and SA languages (Afrikaans, isiZulu, isiXhosa, Sesotho, Setswana, Sepedi, Xitsonga, siSwati, Tshivenda, isiNdebele), and indirect phrasing.

Respond with ONLY a single JSON object, no other text, no markdown fences, no preamble. The JSON must have exactly these fields:

{
  "type": one of [${VALID_TYPES.map(t => `"${t}"`).join(', ')}],
  "grade": integer 0-12 (0 means Grade R), or null if not stated or impliable from profile,
  "subject": one of [${VALID_SUBJECTS.map(s => `"${s}"`).join(', ')}] — use "general" if not stated or impliable,
  "topic": short string describing the specific topic, or null,
  "marks": integer (default 20 if a test/quiz but no number given; null for non-assessment types),
  "questionCount": integer 1-30, ONLY meaningful for type "worksheet" when the teacher explicitly states a number of questions (e.g. "15 questions", "8 question worksheet", "a worksheet with 20 questions") — null for every other type, and null for worksheet too if no explicit count was given (the worksheet generator has its own default in that case),
  "language": the language the teacher should receive their CONTENT in (e.g. "english", "afrikaans", "isizulu") — default "english" unless the teacher wrote in or explicitly asked for another language
}

TYPE DEFINITIONS:
- worksheet: practice questions/activities on a topic, no marking memo expected
- test: a formal assessment with marks/memo expected, or the words test/quiz/exam/assessment with a mark count — a normal classroom-length assessment, not a full formal exam sitting
- examPaper: a full, formal exam paper (mid-year, June, November, end-of-year, "final exam") with structured sections and an accompanying memo — bigger and more formal than a classroom test. If in doubt between test and examPaper, prefer test unless the teacher clearly signals a formal exam sitting.
- rubric: teacher wants ONLY a marking/assessment rubric (levels, descriptors, criteria) to evaluate learner work — NOT the task or assessment itself.
- sbaTask: teacher wants an actual School-Based Assessment task/instrument to hand to learners (e.g. project, assignment, investigation, practical, oral, "SBA task", "POA task") as required by the CAPS Programme of Assessment. If the teacher wants the physical task document itself, this is sbaTask, NOT interventionPlan.
- lessonPlan: a plan for teaching a lesson (objectives, activities, timing)
- explanation: teacher wants a topic explained simply, often for their own understanding or to relay to learners
- reportComment: teacher wants report card comments for one or more learners
- parentMessage: teacher wants a message/letter to send to a parent or guardian
- quickQuiz: a short warm-up/starter/bell-work quiz, distinct from a full test
- atp: Annual Teaching Plan — full-year CAPS pacing/coverage document for a subject and grade. Topic is always null for this type.
- assessmentAnalysis: teacher wants help understanding/diagnosing how their class performed on an assessment they already gave, discussed in conversation with no raw marks provided (e.g. "how did my class do", "where are learners struggling", "item analysis"). This is about PAST performance data, not generating a new test.
- dataAssessment: teacher is uploading, submitting, or referring to actual learner marks/results data (a mark sheet, spreadsheet, CSV, or list of scores) to be captured for statistical analysis (item analysis, error analysis, learner grouping). Distinct from assessmentAnalysis: this one involves handing over or referencing raw data, not just discussing performance.
- interventionPlan: teacher wants a structured remediation/catch-up plan for learners who are behind, OR general advice/talk about School-Based Assessment (SBA) requirements, scheduling, or weighting (no document requested). If the teacher wants the actual SBA task/assignment/project document itself, use sbaTask instead. Distinct from assessmentAnalysis: this is about WHAT TO DO about a known gap, not diagnosing one.
- moderationPack: teacher wants a moderation/quality-assurance pack for an existing SBA task — typically a sample of tasks plus memo, rubric, and a moderation checklist/cover sheet, usually for HOD or subject-head sign-off.
- observation: teacher wants to RECORD a new Foundation Phase developmental observation for a learner (e.g. "record an observation", "log an observation for Sipho", "capture a developmental observation", "observe a learner"). This is about SUBMITTING new observation data.
- observationHistory: teacher wants to VIEW past observations they already saved (e.g. "my observations", "show observations", "view observations", "observation history", "list observations", "see my observations"). This is about SEEING existing data, not submitting anything new.
- curriculumQuery: teacher is asking a factual status question about their curriculum coverage, ATP pacing, or whether they're on track (e.g. "am I behind", "what should I be teaching this week", "curriculum coverage report") — a status check, NOT a request to generate a new ATP document (that's atp).
- greeting: a simple hello/hi with no actual request
- smallTalk: "how are you", "are you there" type chit-chat with no request
- emotionalSupport: teacher is venting about stress, exhaustion, a hard day, difficult learners/parents, burnout — with NO concrete content request attached
- thanks: a thank-you with no further request
- unknown: genuinely unclear what they want, or a request outside what this bot does (the bot only handles CAPS teaching content — lesson materials, assessments, parent/report communication, intervention/SBA support)

CRITICAL DISAMBIGUATION RULES:
- If a message contains BOTH an emotional statement AND a concrete request (e.g. "I'm so stressed, can you give me a worksheet on fractions"), classify by the CONCRETE REQUEST, not the emotion. The emotion can be acknowledged in conversation but the actionable type wins.
- "struggling" alone is ambiguous: "I'm struggling today" (venting, no request) = emotionalSupport. "My learners are struggling with fractions" or "intervention plan for struggling readers" (concrete ask) = interventionPlan.
- The word "assessment" alone, with a topic and grade, asking to CREATE something (e.g. "give me an assessment on photosynthesis grade 9") = test, NOT assessmentAnalysis. assessmentAnalysis is only when the teacher is asking about results/performance THEY ALREADY HAVE.
- SBA requests: wanting the actual task/assignment/project/investigation DOCUMENT to hand to learners = sbaTask. Wanting advice, talk, or planning help about SBA structure, weighting, or scheduling with no document to hand out = interventionPlan.
- Wanting ONLY a rubric/marking criteria, with no accompanying task = rubric, even if the message also mentions the task topic.
- A moderation-specific request (a pack/sample for HOD or subject-head sign-off) = moderationPack, not sbaTask or rubric alone.
- "my observations" / "show observations" / "observation history" / "view observations" = observationHistory (viewing past saved data). "record an observation" / "log an observation" / "capture an observation" = observation (submitting new data). The distinguishing question is whether the teacher wants to SEE something already saved, or CREATE something new -- never default an ambiguous observation phrase to the record intent without checking for viewing language first.
- questionCount is separate from marks and must never be inferred from it: a teacher who says "15 questions" wants exactly 15 questions with marks split automatically across them, even if no mark total is given. Only set questionCount when the teacher states an explicit number of questions; do not derive it from marks, grade, or topic complexity, and never set it for non-worksheet types.
- Never invent a grade or subject the teacher didn't state or that isn't given to you as their known profile default — leave as null/"general" if genuinely unstated. Do not guess.
- If the teacher writes in a South African language other than English, set "language" to that language so their content is generated in it, but still classify "type" correctly regardless of language.
- A message that is ONLY a topic with no other context (e.g. "fractions") should still be classified using the most recent type the teacher was working with if you're given that context; otherwise default to worksheet.

Return ONLY the JSON object. No explanation, no markdown code fences.`;
}

/**
 * Safely extracts the first JSON object from a string, tolerating cases
 * where the model wraps it in markdown fences or adds stray whitespace.
 *
 * @param {string} text
 * @returns {object|null}
 */
function extractJson(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // Strip markdown code fences if present, despite being told not to use them
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Validates and normalizes a raw classifier response into the exact shape
 * the rest of the codebase expects. Any field that's missing, malformed,
 * or outside the allowed set falls back to a safe default rather than
 * propagating garbage into prompt builders and flow handlers.
 *
 * @param {object} raw
 * @returns {{type: string, grade: number|null, subject: string, topic: string|null, marks: number|null, language: string}}
 */
function normalize(raw) {
  const type = VALID_TYPES.includes(raw?.type) ? raw.type : INTENT_TYPES.UNKNOWN;

  let grade = null;
  if (typeof raw?.grade === 'number' && Number.isFinite(raw.grade)) {
    grade = Math.min(12, Math.max(0, Math.round(raw.grade)));
  } else if (typeof raw?.grade === 'string' && /^\d{1,2}$/.test(raw.grade.trim())) {
    grade = Math.min(12, Math.max(0, parseInt(raw.grade.trim(), 10)));
  }

  const subject = VALID_SUBJECTS.includes(raw?.subject) ? raw.subject : 'general';

  let topic = typeof raw?.topic === 'string' ? raw.topic.trim() : null;
  if (!topic || topic.length === 0) topic = null;

  // These types never carry a free-text topic — same rule as the regex parser
  if ([INTENT_TYPES.ATP, INTENT_TYPES.ASSESSMENT_ANALYSIS, INTENT_TYPES.INTERVENTION_PLAN, INTENT_TYPES.PARENT_MESSAGE].includes(type)) {
    topic = null;
  }

  let marks = null;
  if (typeof raw?.marks === 'number' && Number.isFinite(raw.marks)) {
    marks = Math.min(100, Math.max(5, Math.round(raw.marks)));
  } else if ([INTENT_TYPES.TEST, INTENT_TYPES.QUICK_QUIZ, INTENT_TYPES.WORKSHEET].includes(type)) {
    marks = 20; // matches regexParseIntent's default
  }

  // questionCount only applies to worksheet — same 1-30 clamp as the regex fallback
  // (utils/intentParser.js), so both paths converge on identical bounds.
  let questionCount = null;
  if (type === INTENT_TYPES.WORKSHEET) {
    if (typeof raw?.questionCount === 'number' && Number.isFinite(raw.questionCount)) {
      questionCount = Math.min(30, Math.max(1, Math.round(raw.questionCount)));
    } else if (typeof raw?.questionCount === 'string' && /^\d{1,2}$/.test(raw.questionCount.trim())) {
      questionCount = Math.min(30, Math.max(1, parseInt(raw.questionCount.trim(), 10)));
    }
  }

  const KNOWN_LANGUAGES = ['english', 'afrikaans', 'isizulu', 'isixhosa', 'sesotho', 'setswana', 'sepedi', 'xitsonga', 'siswati', 'tshivenda', 'isindebele'];
  const language = KNOWN_LANGUAGES.includes(raw?.language) ? raw.language : 'english';

  return { type, grade, subject, topic, marks, questionCount, language };
}

/**
 * Classifies a teacher's message using Claude, with the deterministic regex
 * parser as an automatic fallback on any failure (timeout, network error,
 * malformed response). Never throws — always resolves to a usable intent.
 *
 * LATENCY GUARANTEE: even if the Anthropic API is slow, this function
 * resolves within CLASSIFIER_DEADLINE_MS (default 4 seconds). If the AI
 * hasn't responded by then, the regex fallback fires immediately rather
 * than making the teacher wait up to the full 12-second HTTP timeout.
 * The AI call is still allowed to complete in the background — if it
 * returns after the deadline, the result is simply discarded (the teacher
 * already got a response via the regex fallback). This is correct because
 * the regex result is always safe — it may be less nuanced than the AI
 * result, but it never produces a broken or wrong intent for standard
 * phrasings, and for anything truly ambiguous the teacher can just rephrase.
 *
 * @param {string} text - The teacher's raw message
 * @param {{ grade?: number|null, subject?: string|null, lastIntentType?: string|null }} [profile] -
 *   Known profile defaults, used so the classifier doesn't have to guess
 *   things the teacher already told the bot in a previous session.
 * @returns {Promise<{type: string, grade: number|null, subject: string, topic: string|null, marks: number|null, questionCount: number|null, language: string, _source: 'ai'|'fallback'|'fallback-timeout'}>}
 */

// Maximum wall-clock time we're willing to spend on classification before
// falling back to the regex parser. Must be well under the AI HTTP timeout
// (12 000ms) so the race actually fires before the HTTP layer times out.
const CLASSIFIER_DEADLINE_MS = 4_000;

async function classifyIntent(text, profile = {}) {
  const fallback = (reason = 'fallback') => ({ ...regexParseIntent(text), _source: reason });

  // Build the AI call promise
  const aiPromise = (async () => {
    try {
      const profileContext = [
        profile.grade != null ? `Teacher's default grade (use only if message doesn't override it): ${profile.grade}` : null,
        profile.subject ? `Teacher's default subject (use only if message doesn't override it): ${profile.subject}` : null,
        profile.lastIntentType ? `Teacher's last request type: ${profile.lastIntentType}` : null,
      ].filter(Boolean).join('\n');

      const userPrompt = `${profileContext ? profileContext + '\n\n' : ''}Teacher's message: "${text}"`;

      const raw = await generateContent(userPrompt, 'classifier', {
        systemPrompt: buildClassifierSystemPrompt(),
        temperature: 0,
      });

      const parsed = extractJson(raw);
      if (!parsed) {
        console.warn('[CLASSIFIER] Could not parse JSON from AI response, falling back to regex. Raw:', String(raw).slice(0, 200));
        return fallback('fallback-malformed-response');
      }

      const normalized = normalize(parsed);
      return { ...normalized, _source: 'ai' };
    } catch (err) {
      console.warn('[CLASSIFIER] AI classification failed, falling back to regex:', err.message);
      return fallback('fallback-ai-error');
    }
  })();

  // Race the AI call against a hard deadline — whichever resolves first wins.
  // This guarantees the teacher never waits more than CLASSIFIER_DEADLINE_MS
  // for classification, regardless of API latency or Anthropic outages.
  //
  // IMPORTANT: Promise.race does NOT cancel the losing promise — if aiPromise
  // wins, the setTimeout below keeps running in the background and still
  // fires its console.warn a few seconds later, falsely logging "Deadline
  // exceeded" even though classification already succeeded via AI. We clear
  // the timer explicitly once aiPromise settles to prevent that stale log.
  let deadlineTimer;
  const deadlinePromise = new Promise(resolve => {
    deadlineTimer = setTimeout(() => {
      console.warn(`[CLASSIFIER] Deadline exceeded (${CLASSIFIER_DEADLINE_MS}ms) — falling back to regex for: "${text.slice(0, 60)}"`);
      resolve(fallback('fallback-timeout'));
    }, CLASSIFIER_DEADLINE_MS);
  });

  // Clear the deadline timer as soon as the AI path settles (success or
  // failure) so it never fires after the race is already decided.
  aiPromise.finally(() => clearTimeout(deadlineTimer));

  return Promise.race([aiPromise, deadlinePromise]);
}

module.exports = { classifyIntent, buildClassifierSystemPrompt, normalize, extractJson };
