// flows/blueprintAuthoringFlow.js
// RC1-H-001 — Conversational Assessment Blueprint authoring.
//
// Lets a teacher build and publish an Assessment Blueprint entirely from
// WhatsApp, with no dev script. Mirrors flows/assessmentSessionFlow.js's
// exact shape (STEP enum + SQLite-backed SessionStore + NavigationService
// CANCEL/STATUS delegation) so it reads as the same family of flow, not a
// bespoke one-off.
//
// State machine:
//   (no session) -> HEADER_TITLE -> HEADER_SUBJECT -> HEADER_GRADE ->
//   HEADER_TERM -> HEADER_TOTAL_MARKS -> ADD_QUESTION (loop) -> REVIEW ->
//   PUBLISHED_MENU
//
// Persistence: nothing is written to assessment_blueprints /
// blueprint_questions until the teacher replies PUBLISH from REVIEW —
// createBlueprint() is called there for the first time. An abandoned
// session before that point (CANCEL, or the SessionStore TTL simply
// expiring) leaves zero DB rows, matching assessmentCaptureService's
// "nothing committed until completion" philosophy.
//
// CAPS topic validation: this flow does not reimplement CAPS checking.
// It calls publishBlueprint(), which already enforces it, and handles
// the err.unresolvedTopics failure shape by staying on REVIEW so the
// teacher can retype just the affected question(s) rather than
// restarting the whole flow. Because createBlueprint() has already run
// by the time publishBlueprint() can fail this way, a failed first
// PUBLISH attempt leaves a *draft* blueprint row behind (never a
// published one) — retrying re-uses that same blueprintId rather than
// creating a duplicate draft.
//
// Scope guard (see RC1-H-001 spec): no optional question fields
// (subtopic/bloomLevel/atpReference/expectedMisconception), no revision
// UX, no archive/delete UX, no mid-question editing (CANCEL + restart
// covers that), no bulk/CSV import, no AI-assisted question generation.
//
// Dependencies injected via buildBlueprintAuthoringDeps() in webhook.js;
// no reverse dependency on webhook.js (matches every sibling flow).

const navigationService = require('../services/navigationService');
const { parseGrade } = require('../utils/capsPhase');

const STEP = {
  HEADER_TITLE: 'headerTitle',
  HEADER_SUBJECT: 'headerSubject',
  HEADER_GRADE: 'headerGrade',
  HEADER_TERM: 'headerTerm',
  HEADER_TOTAL_MARKS: 'headerTotalMarks',
  ADD_QUESTION: 'addQuestion',
  REVIEW: 'review',
  // Mirrors assessmentSessionFlow's COMPLETE_MENU: once published, offer
  // the natural next actions instead of leaving the teacher at a blank
  // slate. Scope is deliberately narrow — NEW TEST / PRINT only, both of
  // which assessmentSessionFlow already owns; this flow never reimplements
  // their behaviour, it just dispatches into them when both are supplied.
  PUBLISHED_MENU: 'publishedMenu',
};

const PUBLISHED_MENU_ID = 'blueprintAuthoring.published';
const PUBLISHED_MENU_OPTIONS = { '1': 'NEW_ASSESSMENT', '2': 'PRINT' };

function formatPublishedMenu() {
  return 'What would you like to do next?\n\n1. Start a new assessment (NEW TEST)\n2. Print a blueprint question paper (PRINT)';
}

// Accepts "Grade 6", "Gr 6", "6", "R", "Grade R" — a bare digit/letter is
// the common case for a direct WhatsApp reply, so it's checked first
// rather than forcing the teacher through parseGrade()'s "grade/gr/g"
// prefix requirement.
function parseHeaderGrade(text) {
  const trimmed = String(text || '').trim();
  if (/^r$/i.test(trimmed)) return 0;
  if (/^\d{1,2}$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return n >= 0 && n <= 12 ? n : null;
  }
  return parseGrade(trimmed);
}

function parseHeaderTerm(text) {
  const trimmed = String(text || '').trim();
  if (/^skip$/i.test(trimmed)) return { ok: true, term: null };
  if (/^[1-4]$/.test(trimmed)) return { ok: true, term: parseInt(trimmed, 10) };
  return { ok: false };
}

function parseHeaderTotalMarks(text) {
  const trimmed = String(text || '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return n > 0 ? n : null;
}

// Accepts "<topic> | <max marks>" (question number auto-assigned) or
// "<question number> | <topic> | <max marks>" (explicit number, for a
// teacher re-pasting/reordering). Deliberately strict — no fuzzy
// splitting — since a misparsed question number or mark value would
// silently corrupt the blueprint being built.
function parseQuestionReply(text, nextQuestionNumber) {
  const parts = String(text || '').split('|').map((p) => p.trim());

  if (parts.length === 2) {
    const [topic, marksRaw] = parts;
    if (!topic || !/^\d+$/.test(marksRaw)) return null;
    const maxMarks = parseInt(marksRaw, 10);
    if (maxMarks <= 0) return null;
    return { questionNumber: nextQuestionNumber, topic, maxMarks };
  }

  if (parts.length === 3) {
    const [numRaw, topic, marksRaw] = parts;
    if (!/^\d+$/.test(numRaw) || !topic || !/^\d+$/.test(marksRaw)) return null;
    const questionNumber = parseInt(numRaw, 10);
    const maxMarks = parseInt(marksRaw, 10);
    if (questionNumber <= 0 || maxMarks <= 0) return null;
    return { questionNumber, topic, maxMarks };
  }

  return null;
}

const FIX_PATTERN = /^FIX\s+(\d+)\s+(.+)$/i;

function formatQuestionsList(questions) {
  return questions
    .map((q) => `Q${q.questionNumber}. ${q.topic} — ${q.maxMarks}`)
    .join('\n');
}

function formatReview(state) {
  const termLine = state.term != null ? `, Term ${state.term}` : '';
  const header = `${state.title} — Grade ${state.grade} ${state.subject}${termLine}, ${state.totalMarks} marks`;
  const lines = [`📋 Review:`, header, formatQuestionsList(state.questions)];

  if (state.unresolvedTopics && state.unresolvedTopics.length > 0) {
    lines.push('', formatUnresolvedTopics(state.unresolvedTopics));
    lines.push('Reply *FIX <question number> <new topic>* for each one, then *PUBLISH* to try again, or *CANCEL* to discard.');
  } else {
    lines.push('', 'Reply *PUBLISH* to publish, or *CANCEL* to discard.');
  }

  return lines.join('\n');
}

function formatUnresolvedTopics(unresolvedTopics) {
  const lines = unresolvedTopics.map((r) => {
    const suggestion = r.suggestions && r.suggestions.length > 0
      ? ` Did you mean: ${r.suggestions.join(' / ')}?`
      : '';
    return `⚠️ Q${r.questionNumber} — "${r.topic}" isn't a recognised CAPS topic.${suggestion}`;
  });
  return lines.join('\n');
}

/**
 * Attempts to publish the blueprint currently held in `state`. On the
 * first attempt, this also creates the DB rows (createBlueprint()) —
 * see this file's header comment for why persistence starts here and
 * not earlier. Returns the new state to persist and the message to send;
 * never throws — repository/validation failures are folded into the
 * returned state/message instead, matching every other step's contract.
 */
function attemptPublish(phoneHash, state, deps) {
  const { createBlueprint, publishBlueprint } = deps;

  let blueprintId = state.blueprintId;

  if (blueprintId == null) {
    try {
      const created = createBlueprint(
        phoneHash,
        {
          title: state.title,
          subject: state.subject,
          grade: state.grade,
          term: state.term,
          totalMarks: state.totalMarks,
        },
        state.questions.map((q) => ({
          questionNumber: q.questionNumber,
          topic: q.topic,
          maxMarks: q.maxMarks,
        }))
      );
      blueprintId = created.blueprintId;
    } catch (err) {
      // Nothing was committed (createBlueprint is transactional), so the
      // session stays exactly as it was — the teacher can just retry.
      return {
        nextState: { ...state, lastActivity: Date.now() },
        message: `Couldn't save the blueprint: ${err.message}. Reply *PUBLISH* to try again, or *CANCEL* to discard.`,
      };
    }
  }

  try {
    publishBlueprint(blueprintId, phoneHash);
  } catch (err) {
    if (err.unresolvedTopics) {
      const nextState = {
        ...state,
        blueprintId,
        unresolvedTopics: err.unresolvedTopics,
        step: STEP.REVIEW,
        lastActivity: Date.now(),
      };
      return { nextState, message: formatReview(nextState) };
    }

    // Any other publish failure (ownership, already-published, no
    // questions — all defensive at this point) — surface it and let the
    // teacher decide whether to retry or cancel.
    return {
      nextState: { ...state, blueprintId, lastActivity: Date.now() },
      message: `Couldn't publish the blueprint: ${err.message}. Reply *PUBLISH* to try again, or *CANCEL* to discard.`,
    };
  }

  return { nextState: null, message: null, blueprintId, published: true };
}

async function handleBlueprintAuthoringFlow(from, text, message = null, preClassifiedIntent = null, deps) {
  const {
    hashPhone,
    safeSendMessage,
    blueprintAuthoringState, // SessionStore instance
    getBlueprintById,
    updateQuestion,
    // Optional — only needed to dispatch PUBLISHED_MENU's NEW TEST/PRINT
    // options into assessmentSessionFlow. If either is missing, the menu
    // still renders but a digit press just tells the teacher to type the
    // command themselves.
    handleAssessmentSessionFlow,
    buildAssessmentSessionDeps,
  } = deps;

  const phoneHash = hashPhone(from);
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  let state = blueprintAuthoringState.get(phoneHash);

  // ── No session in progress ────────────────────────────────────────────
  if (!state) {
    if (upper === 'NEW BLUEPRINT') {
      blueprintAuthoringState.set(phoneHash, {
        step: STEP.HEADER_TITLE,
        questions: [],
        lastActivity: Date.now(),
      });
      await safeSendMessage(from,
        '📋 Let\'s create a new Assessment Blueprint.\n\nWhat\'s the title? (e.g. "Fractions Test Term 2")'
      );
      return true;
    }
    return false; // not our concern — let normal routing continue
  }

  // ── A session is in progress: CANCEL and STATUS work from any step ────
  // Mirrors assessmentSessionFlow's ADR-019 Commit 3b delegation exactly
  // — see that file's comment for why handleCancel() is deliberately not
  // used (it attaches a YES-confirmation prompt this flow doesn't have).
  if (upper === 'CANCEL') {
    navigationService.getFlowDefinition('blueprintAuthoring').hooks.cleanup(phoneHash);
    const note = state.blueprintId != null
      ? ' A draft blueprint was already saved but was not published — it will not appear anywhere until you publish it.'
      : ' Nothing was saved.';
    await safeSendMessage(from, `Blueprint creation cancelled.${note}`);
    return true;
  }

  if (upper === 'STATUS') {
    const owner = navigationService.resolveStatusOwner('blueprintAuthoring');
    const statusMessage = owner.owner === 'flow'
      ? navigationService.getFlowDefinition('blueprintAuthoring').hooks.describeStatus(phoneHash)
      : describeStatus(state);
    await safeSendMessage(from, statusMessage);
    return true;
  }

  // NEW BLUEPRINT while a session is already active — don't silently
  // clobber it. PUBLISHED_MENU is the one exception: nothing is actually
  // "in progress" there anymore, so typing NEW BLUEPRINT should behave
  // like picking the matching action from scratch.
  if (upper === 'NEW BLUEPRINT') {
    if (state.step === STEP.PUBLISHED_MENU) {
      navigationService.closeMenu(phoneHash);
      blueprintAuthoringState.delete(phoneHash);
      return handleBlueprintAuthoringFlow(from, upper, message, preClassifiedIntent, deps);
    }
    await safeSendMessage(from,
      `You already have a blueprint in progress.\n\n${describeStatus(state)}\n\nSend *CANCEL* first if you want to discard it and start a new one.`
    );
    return true;
  }

  // ── HEADER_TITLE ─────────────────────────────────────────────────────
  if (state.step === STEP.HEADER_TITLE) {
    if (!trimmed) {
      await safeSendMessage(from, 'Please reply with a title for this blueprint.');
      return true;
    }
    blueprintAuthoringState.set(phoneHash, { ...state, title: trimmed, step: STEP.HEADER_SUBJECT, lastActivity: Date.now() });
    await safeSendMessage(from, 'Subject?');
    return true;
  }

  // ── HEADER_SUBJECT ───────────────────────────────────────────────────
  if (state.step === STEP.HEADER_SUBJECT) {
    if (!trimmed) {
      await safeSendMessage(from, 'Please reply with a subject.');
      return true;
    }
    blueprintAuthoringState.set(phoneHash, { ...state, subject: trimmed, step: STEP.HEADER_GRADE, lastActivity: Date.now() });
    await safeSendMessage(from, 'Grade?');
    return true;
  }

  // ── HEADER_GRADE ─────────────────────────────────────────────────────
  if (state.step === STEP.HEADER_GRADE) {
    const grade = parseHeaderGrade(trimmed);
    if (grade === null) {
      await safeSendMessage(from, 'Please reply with a grade (e.g. "6" or "R").');
      return true;
    }
    blueprintAuthoringState.set(phoneHash, { ...state, grade, step: STEP.HEADER_TERM, lastActivity: Date.now() });
    await safeSendMessage(from, 'Term? (or reply SKIP)');
    return true;
  }

  // ── HEADER_TERM ──────────────────────────────────────────────────────
  if (state.step === STEP.HEADER_TERM) {
    const result = parseHeaderTerm(trimmed);
    if (!result.ok) {
      await safeSendMessage(from, 'Please reply with a term (1-4), or SKIP.');
      return true;
    }
    blueprintAuthoringState.set(phoneHash, { ...state, term: result.term, step: STEP.HEADER_TOTAL_MARKS, lastActivity: Date.now() });
    await safeSendMessage(from, 'Total marks for the whole assessment?');
    return true;
  }

  // ── HEADER_TOTAL_MARKS ───────────────────────────────────────────────
  if (state.step === STEP.HEADER_TOTAL_MARKS) {
    const totalMarks = parseHeaderTotalMarks(trimmed);
    if (totalMarks === null) {
      await safeSendMessage(from, 'Please reply with the total marks as a number (e.g. "20").');
      return true;
    }
    blueprintAuthoringState.set(phoneHash, { ...state, totalMarks, step: STEP.ADD_QUESTION, lastActivity: Date.now() });
    await safeSendMessage(from,
      'Question 1 — reply as: <topic> | <max marks>\n(e.g. "Common Fractions | 5")'
    );
    return true;
  }

  // ── ADD_QUESTION (loop) ──────────────────────────────────────────────
  if (state.step === STEP.ADD_QUESTION) {
    if (upper === 'DONE') {
      if (state.questions.length === 0) {
        await safeSendMessage(from,
          'Add at least one question before finishing — reply as: <topic> | <max marks>'
        );
        return true;
      }
      const reviewState = { ...state, step: STEP.REVIEW, lastActivity: Date.now() };
      blueprintAuthoringState.set(phoneHash, reviewState);
      await safeSendMessage(from, formatReview(reviewState));
      return true;
    }

    const nextQuestionNumber = state.questions.length + 1;
    const parsed = parseQuestionReply(trimmed, nextQuestionNumber);
    if (!parsed) {
      await safeSendMessage(from,
        'Please reply as: <topic> | <max marks> (e.g. "Common Fractions | 5"), or DONE to finish.'
      );
      return true;
    }

    const nextState = {
      ...state,
      questions: [...state.questions, parsed],
      lastActivity: Date.now(),
    };
    blueprintAuthoringState.set(phoneHash, nextState);
    await safeSendMessage(from,
      `Added Q${parsed.questionNumber}: ${parsed.topic} (${parsed.maxMarks} marks). Reply with the next question, or DONE.`
    );
    return true;
  }

  // ── REVIEW ───────────────────────────────────────────────────────────
  if (state.step === STEP.REVIEW) {
    // FIX <question number> <new topic> — only meaningful once a publish
    // attempt has actually flagged unresolved topics; otherwise treated
    // as an unrecognised reply below.
    const fixMatch = trimmed.match(FIX_PATTERN);
    if (fixMatch && state.unresolvedTopics && state.unresolvedTopics.length > 0) {
      const questionNumber = parseInt(fixMatch[1], 10);
      const newTopic = fixMatch[2].trim();
      const question = state.questions.find((q) => q.questionNumber === questionNumber);
      const wasUnresolved = state.unresolvedTopics.some((r) => r.questionNumber === questionNumber);

      if (!question || !wasUnresolved) {
        await safeSendMessage(from,
          `Q${questionNumber} isn't one of the questions flagged for a topic fix.\n\n${formatReview(state)}`
        );
        return true;
      }

      // The draft row already exists in the DB (createBlueprint already
      // ran on the first PUBLISH attempt) — update it there too, not
      // just in the in-memory session, so the retried publishBlueprint()
      // call sees the corrected topic.
      const dbBlueprint = getBlueprintById(state.blueprintId);
      const dbQuestion = dbBlueprint && dbBlueprint.questions.find((q) => q.questionNumber === questionNumber);
      if (dbQuestion) {
        try {
          updateQuestion(dbQuestion.id, phoneHash, { topic: newTopic });
        } catch (err) {
          await safeSendMessage(from, `Couldn't update Q${questionNumber}: ${err.message}`);
          return true;
        }
      }

      const nextState = {
        ...state,
        questions: state.questions.map((q) => (q.questionNumber === questionNumber ? { ...q, topic: newTopic } : q)),
        unresolvedTopics: state.unresolvedTopics.filter((r) => r.questionNumber !== questionNumber),
        lastActivity: Date.now(),
      };
      blueprintAuthoringState.set(phoneHash, nextState);
      await safeSendMessage(from, `Updated Q${questionNumber}.\n\n${formatReview(nextState)}`);
      return true;
    }

    if (upper === 'PUBLISH') {
      const result = attemptPublish(phoneHash, state, deps);

      if (result.published) {
        blueprintAuthoringState.set(phoneHash, { step: STEP.PUBLISHED_MENU, lastActivity: Date.now() });
        navigationService.openMenu(phoneHash, { id: PUBLISHED_MENU_ID, options: PUBLISHED_MENU_OPTIONS });
        await safeSendMessage(from, `✅ Published! "${state.title}" is now available.\n\n${formatPublishedMenu()}`);
        return true;
      }

      blueprintAuthoringState.set(phoneHash, result.nextState);
      await safeSendMessage(from, result.message);
      return true;
    }

    // Unrecognised reply at REVIEW — re-render the review/prompt rather
    // than silently doing nothing.
    await safeSendMessage(from, formatReview(state));
    return true;
  }

  // ── PUBLISHED_MENU ───────────────────────────────────────────────────
  if (state.step === STEP.PUBLISHED_MENU) {
    const consumed = navigationService.consumeNumericReply(phoneHash, trimmed);
    if (consumed.matched) {
      blueprintAuthoringState.delete(phoneHash);

      if (typeof handleAssessmentSessionFlow === 'function' && typeof buildAssessmentSessionDeps === 'function') {
        if (consumed.value === 'NEW_ASSESSMENT') {
          return handleAssessmentSessionFlow(from, 'NEW TEST', message, preClassifiedIntent, buildAssessmentSessionDeps());
        }
        if (consumed.value === 'PRINT') {
          return handleAssessmentSessionFlow(from, 'PRINT', message, preClassifiedIntent, buildAssessmentSessionDeps());
        }
      }

      await safeSendMessage(from,
        consumed.value === 'NEW_ASSESSMENT'
          ? 'Send *NEW TEST* to start a session with this blueprint.'
          : 'Send *PRINT* to get a printable question paper.'
      );
      return true;
    }

    // Re-open the menu on an invalid/expired reply, same precedent as
    // assessmentSessionFlow's COMPLETE_MENU.
    navigationService.openMenu(phoneHash, { id: PUBLISHED_MENU_ID, options: PUBLISHED_MENU_OPTIONS });
    await safeSendMessage(from, formatPublishedMenu());
    return true;
  }

  return false;
}

function describeStatus(state) {
  switch (state.step) {
    case STEP.HEADER_TITLE:
      return 'Session status: waiting for the blueprint title.';
    case STEP.HEADER_SUBJECT:
      return `Session status: *${state.title}* — waiting for the subject.`;
    case STEP.HEADER_GRADE:
      return `Session status: *${state.title}* — waiting for the grade.`;
    case STEP.HEADER_TERM:
      return `Session status: *${state.title}* — waiting for the term (or SKIP).`;
    case STEP.HEADER_TOTAL_MARKS:
      return `Session status: *${state.title}* — waiting for total marks.`;
    case STEP.ADD_QUESTION:
      return `Session status: *${state.title}* — ${state.questions.length} question${state.questions.length === 1 ? '' : 's'} added so far.\n\n${formatQuestionsList(state.questions)}\n\nReply with the next question, or DONE.`;
    case STEP.REVIEW:
      return formatReview(state);
    case STEP.PUBLISHED_MENU:
      return `Session status: blueprint published.\n\n${formatPublishedMenu()}`;
    default:
      return 'Session status: unknown.';
  }
}

module.exports = {
  handleBlueprintAuthoringFlow,
  STEP,
  describeStatus,
  PUBLISHED_MENU_ID,
  PUBLISHED_MENU_OPTIONS,
};
