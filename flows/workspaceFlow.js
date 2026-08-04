'use strict';

/**
 * Workspace flow handler — extracted from routes/webhook.js.
 *
 * Covers the read-only / class-management "Teacher Workspace" commands:
 *   NEW CLASS, MY CLASSES, MY ASSESSMENTS / MY ASSESSMENT HISTORY,
 *   MY PROGRESS / MY CURRICULUM PROGRESS, WORKSPACE, CLASS INTERVENTION.
 *
 * CLASS INTERVENTION [selector] (ADR-009, PR12) is a thin WhatsApp-facing
 * wrapper around ClassInterventionService.getClassInterventionPlan() —
 * this flow does no aggregation of its own. Class resolution reuses the
 * same 0/1/2+ selector convention as LEARNER PROGRESS <name>: with one
 * class it's used automatically, with zero the teacher is told to create
 * one, and with 2+ the teacher must disambiguate in the same message
 * (CLASS INTERVENTION 2 or CLASS INTERVENTION Grade 7A) — same stateless,
 * single-message convention every other read-only workspace command uses
 * here (no session state is introduced for this).
 *
 * Deliberately excludes SAVE and MY RESOURCES: those belong to the generic
 * 8-resource-type SAVE lifecycle infrastructure (teacherWorkspaceService's
 * saveResource/getSavedResources plumbing) shared with every other flow's
 * "generate → SAVE" pattern, not to workspace specifically. Per ADR-001,
 * that machinery stays in webhook.js today and migrates to
 * core/generationPipeline later — it should not be folded into
 * workspaceFlow just because it was textually adjacent in the original
 * isWorkspaceCmd block.
 *
 * Dependencies are injected via the `deps` object rather than required
 * directly, so this module has no reverse dependency on webhook.js.
 *
 * Expected deps shape:
 * {
 *   hashPhone,                // (from) => phoneHash
 *   getTeacherByPhone,        // (from) => teacher row | null
 *   safeSendMessage,          // async (from, text) => void
 *   gradeLabel,                // (grade) => string
 *   getTeacherClasses,        // (hash) => Class[]
 *   createClass,              // (hash, name, grade, subject, count) => Class
 *   getAssessmentHistory,     // (hash) => Assessment[]
 *   validateNewClassInput,    // (rawName, rawCount, existingClasses) => { valid, error?, name?, count? }
 *   getTeacherProgressReport, // (hash) => progress | { error }
 *   calendarQuery,            // async (query, teacher) => string  (aliased handleCurriculumQuery)
 *   searchLearnersByName,     // (name, {phoneHash}) => Learner[]  (services/learnerRepository.js)
 *   getLearnerInterventionPlan, // (learnerId) => InterventionPlan[] (services/interventionService.js)
 *                                // Each plan's evidence.mastery carries the full MasteryReport, so this
 *                                // single call supplies both the mastery summary and the intervention
 *                                // section below — workspaceFlow doesn't fetch MasteryReport separately.
 *   getClassInterventionPlan,  // (phoneHash, classId) => ClassInterventionPlan (services/classInterventionService.js)
 *   generateClassInterventionPdf, // (phoneHash, classId) => {fileId, filename}|{error} (services/pdfService.js)
 *   generateLearnerInterventionPdf, // (learnerId) => {fileId, filename}|{error} (services/pdfService.js)
 *   buildPdfUrl,               // (fileId) => string
 *   sendDocument,              // async (from, url, filename, caption) => void
 * }
 */

/**
 * Handles the Teacher Workspace command group.
 * Returns true if handled (skip normal processing), false otherwise.
 *
 * @param {string} from
 * @param {string} text
 * @param {object} deps
 * @returns {Promise<boolean>}
 */
async function handleWorkspaceFlow(from, text, deps) {
  const {
    hashPhone,
    getTeacherByPhone,
    safeSendMessage,
    gradeLabel,
    getTeacherClasses,
    createClass,
    getAssessmentHistory,
    validateNewClassInput,
    getTeacherProgressReport,
    calendarQuery,
    searchLearnersByName,
    getLearnerInterventionPlan,
    getClassInterventionPlan,
    generateClassInterventionPdf,
    generateLearnerInterventionPdf,
    buildPdfUrl,
    sendDocument,
  } = deps;

  const upper = text.trim().toUpperCase();

  const isWorkspaceCmd =
    upper === 'MY CLASSES' || upper.startsWith('NEW CLASS') ||
    upper === 'MY ASSESSMENTS' || upper === 'MY ASSESSMENT HISTORY' ||
    upper === 'MY PROGRESS' || upper === 'MY CURRICULUM PROGRESS' ||
    upper.startsWith('LEARNER PROGRESS') ||
    upper === 'WORKSPACE' ||
    upper.startsWith('CLASS INTERVENTION');

  if (!isWorkspaceCmd) return false;

  const hash = hashPhone(from);
  const teacher = getTeacherByPhone(from);

  if (!teacher) {
    await safeSendMessage(from, `⚠️ You need to complete setup first. Reply *HELLO* to get started.`);
    return true;
  }

  // ── NEW CLASS ──
  if (upper.startsWith('NEW CLASS')) {
    // Format: NEW CLASS Grade 7A Mathematics | 32
    // Parse: everything after "NEW CLASS " is "name | learner_count"
    const rest = text.slice('NEW CLASS'.length).trim();

    // No arguments at all → show usage prompt
    if (!rest) {
      await safeSendMessage(from,
        `📚 *Create a new class*\n\nFormat:\n*NEW CLASS [name] | [learner count]*\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_\n\nThe class name should include the grade and subject.`
      );
      return true;
    }

    // No pipe → missing learner count
    if (!rest.includes('|')) {
      await safeSendMessage(from,
        `📚 *Missing learner count*\n\nPlease include the number of learners after a "|":\n\n*NEW CLASS [name] | [count]*\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_`
      );
      return true;
    }

    const pipeIdx = rest.indexOf('|');
    const rawName  = rest.slice(0, pipeIdx).trim();
    const rawCount = rest.slice(pipeIdx + 1).trim();

    // Load existing classes for duplicate check
    let existingClasses = [];
    try { existingClasses = getTeacherClasses(hash); } catch (_) {}

    const validation = validateNewClassInput(rawName, rawCount, existingClasses);

    if (!validation.valid) {
      const errorMessages = {
        missing_name:       `📚 *Class name required*\n\nPlease provide a name before the "|":\n\n_NEW CLASS Grade 7A Mathematics | 32_`,
        name_too_long:      `📚 *Class name too long*\n\nPlease keep the name under 80 characters.\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_`,
        name_invalid_chars: `📚 *Invalid class name*\n\nThe name must contain at least one letter or number.\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_`,
        missing_count:      `📚 *Learner count required*\n\nPlease add the number of learners after the "|":\n\n_NEW CLASS Grade 7A Mathematics | 32_`,
        count_not_a_number: `📚 *Invalid learner count*\n\nThe learner count must be a number.\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_`,
        count_too_low:      `📚 *Learner count must be at least 1*\n\nA class needs at least one learner.\n\nExample:\n_NEW CLASS Grade 7A Mathematics | 32_`,
        count_too_high:     `📚 *Learner count seems too high*\n\nThe maximum supported class size is 200. If your class is larger, please contact support.`,
        duplicate_name:     `📚 *You already have a class called "${rawName}"*\n\nUse a different name, or reply *MY CLASSES* to see your existing classes.`,
      };
      const msg = errorMessages[validation.error] ||
        `⚠️ Invalid input. Please use the format:\n_NEW CLASS Grade 7A Mathematics | 32_`;
      await safeSendMessage(from, msg);
      return true;
    }

    // Validation passed — extract grade from name (or fall back to teacher profile)
    const gradeMatch = validation.name.match(/\bgrade\s*(\d+)/i);
    const grade = gradeMatch ? parseInt(gradeMatch[1], 10) : (teacher.grade ?? null);
    const subject = teacher.subject || 'General';

    try {
      const newClass = createClass(hash, validation.name, grade, subject, validation.count);
      await safeSendMessage(from,
        `✅ *Class created!*\n\n📚 *${newClass.name}*\nGrade: ${newClass.grade != null ? gradeLabel(newClass.grade) : 'Not set'} | Subject: ${newClass.subject}\nLearners: ${newClass.learner_count}\n\n_Reply *MY CLASSES* to see all your classes._`
      );
    } catch (err) {
      console.error('[Workspace] createClass error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't create the class. Please try again.`);
    }
    return true;
  }

  // ── MY CLASSES ──
  if (upper === 'MY CLASSES') {
    try {
      const classes = getTeacherClasses(hash);
      if (classes.length === 0) {
        await safeSendMessage(from,
          `📚 *Your Classes*\n\nYou haven't added any classes yet.\n\nTo create one, reply:\n*NEW CLASS [name] | [learner count]*\n\nExample:\n_NEW CLASS Grade 8B Mathematics | 28_`
        );
      } else {
        let msg = `📚 *Your Classes* (${classes.length})\n\n`;
        for (const cls of classes) {
          msg += `*${cls.name}*\n`;
          msg += `${cls.grade != null ? gradeLabel(cls.grade) : 'Grade ?'} | ${cls.subject || '?'} | ${cls.learner_count || 0} learners\n\n`;
        }
        msg += `_Reply *NEW CLASS [name] | [count]* to add another class._`;
        await safeSendMessage(from, msg);
      }
    } catch (err) {
      console.error('[Workspace] getTeacherClasses error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load your classes. Please try again.`);
    }
    return true;
  }

  // ── MY ASSESSMENTS ──
  if (upper === 'MY ASSESSMENTS' || upper === 'MY ASSESSMENT HISTORY') {
    try {
      const assessments = getAssessmentHistory(hash);
      if (assessments.length === 0) {
        await safeSendMessage(from,
          `📊 *Assessment History*\n\nNo data-driven assessments on record yet.\n\nTo analyse a class assessment, send your mark sheet and I'll run a full diagnostic.\n\n_Tip: Upload a CSV, Excel file, or photo of your mark sheet._`
        );
      } else {
        const recent = assessments.slice(0, 8);
        let msg = `📊 *Assessment History* (${assessments.length} total)\n\n`;
        for (const a of recent) {
          const avg = a.class_average != null ? `${Math.round(a.class_average)}%` : 'N/A';
          const date = a.created_at ? a.created_at.split(' ')[0] : '';
          msg += `*${a.title || 'Untitled'}*\n`;
          msg += `${a.grade != null ? gradeLabel(a.grade) : 'Grade ?'} | ${a.subject || '?'} | Term ${a.term || '?'}\n`;
          msg += `Class avg: ${avg} | Learners: ${a.learner_count || 0} | ${date}\n\n`;
        }
        if (assessments.length > 8) {
          msg += `_... and ${assessments.length - 8} more older assessments._\n\n`;
        }
        msg += `_Reply *MY PROGRESS* to see curriculum coverage tracked from these assessments._`;
        await safeSendMessage(from, msg);
      }
    } catch (err) {
      console.error('[Workspace] getAssessmentHistory error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load assessment history. Please try again.`);
    }
    return true;
  }

  // ── MY PROGRESS / MY CURRICULUM PROGRESS ──
  if (upper === 'MY PROGRESS' || upper === 'MY CURRICULUM PROGRESS') {
    try {
      const progress = getTeacherProgressReport(hash);

      if (progress && progress.error) {
        // Profile incomplete — fall back to calendar estimate if possible
        if (teacher.grade != null && teacher.subject) {
          const calResult = await calendarQuery(`${teacher.subject} ${gradeLabel(teacher.grade)} coverage`, teacher);
          await safeSendMessage(from, calResult || `⚠️ Complete your profile with grade and subject to see curriculum progress.\n\nReply *PROFILE* to update.`);
        } else {
          await safeSendMessage(from,
            `⚠️ *Profile incomplete*\n\nI need your grade and subject to show curriculum progress.\n\nReply *PROFILE* to update your details.`
          );
        }
        return true;
      }

      if (!progress || !progress.dataAvailable) {
        // Real data exists but subject not in CAPS reference table — use calendar estimate
        const grade = teacher.grade ?? progress?.grade;
        const subject = teacher.subject || progress?.subject;
        if (grade != null && subject) {
          const calResult = await calendarQuery(`${subject} ${gradeLabel(grade)} coverage`, teacher);
          await safeSendMessage(from,
            `📈 *Curriculum Progress — ${subject} ${gradeLabel(grade)}*\n\n` +
            `_Note: Detailed per-topic tracking isn't available for this subject yet. Showing calendar-based estimate:_\n\n` +
            (calResult || `No calendar data available either.`)
          );
        } else {
          await safeSendMessage(from, `⚠️ Set your grade and subject in *PROFILE* to view curriculum progress.`);
        }
        return true;
      }

      // Real persisted data available — use it
      let msg = `📈 *Curriculum Progress — ${progress.subject} ${gradeLabel(progress.grade)}*\n`;
      msg += `_Based on ${progress.totalCovered} topic(s) recorded from your assessments_\n\n`;
      msg += progress.summary;
      if (progress.catchUpPlan && !progress.catchUpPlan.startsWith('✅')) {
        msg += `\n${progress.catchUpPlan}`;
      }
      await safeSendMessage(from, msg);
    } catch (err) {
      console.error('[Workspace] getTeacherProgressReport error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load curriculum progress. Please try again.`);
    }
    return true;
  }

  // ── LEARNER PROGRESS <name> / LEARNER PROGRESS PDF <name> ──
  if (upper.startsWith('LEARNER PROGRESS')) {
    let rest = text.slice('LEARNER PROGRESS'.length).trim();

    // ADR-009 PR15: an optional leading "PDF" token switches this from the
    // WhatsApp-text mastery overview to the downloadable report generated
    // by generateLearnerInterventionPdf() (PR9), mirroring PR14's approach
    // for CLASS INTERVENTION PDF. Everything after "PDF" is still just the
    // same name to search for — learner resolution below is completely
    // unaware of which output format was requested.
    const pdfMatch = rest.match(/^pdf\b\s*/i);
    const wantsPdf = !!pdfMatch;
    const rawName = wantsPdf ? rest.slice(pdfMatch[0].length).trim() : rest;

    if (!rawName) {
      await safeSendMessage(from,
        wantsPdf
          ? `📈 *Look up a learner's progress*\n\nFormat:\n*LEARNER PROGRESS PDF [name]*\n\nExample:\n_LEARNER PROGRESS PDF Sipho_`
          : `📈 *Look up a learner's progress*\n\nFormat:\n*LEARNER PROGRESS [name]*\n\nExample:\n_LEARNER PROGRESS Sipho_`
      );
      return true;
    }

    try {
      const matches = searchLearnersByName(rawName, { phoneHash: hash, limit: 6 });

      if (matches.length === 0) {
        await safeSendMessage(from,
          `⚠️ No learner matching "${rawName}" found in your classes.\n\n_Tip: try just their first name, or reply *MY CLASSES* to check spelling._`
        );
        return true;
      }

      if (matches.length > 1) {
        let msg = `👥 *Multiple learners match "${rawName}"*\n\n`;
        for (const m of matches) {
          msg += `• ${m.canonicalName}\n`;
        }
        msg += `\n_Reply with a more specific name to narrow it down._`;
        await safeSendMessage(from, msg);
        return true;
      }

      const learner = matches[0];

      if (wantsPdf) {
        await generateAndSendLearnerInterventionPdf(from, learner, deps);
        return true;
      }

      // One call supplies both mastery and intervention data: each
      // InterventionPlan's evidence.mastery is the full MasteryReport, so
      // workspaceFlow never fetches MasteryService directly (per ADR-007,
      // delivery surfaces consume the highest-level service that already
      // composes what they need — InterventionService, not MasteryService).
      const plans = getLearnerInterventionPlan(learner.id);

      if (!plans || plans.length === 0) {
        await safeSendMessage(from,
          `📈 *${learner.canonicalName}*\n\nNo assessment or observation data recorded for this learner yet.`
        );
        return true;
      }

      let msg = `📈 *${learner.canonicalName} — Mastery Overview*\n\n`;
      // Prioritise subjects with real evidence over insufficient-data ones.
      const sorted = [...plans].sort((a, b) => {
        const aReady = a.evidence.mastery.masteryLevel !== 'insufficient-data';
        const bReady = b.evidence.mastery.masteryLevel !== 'insufficient-data';
        if (aReady === bReady) return a.subject.localeCompare(b.subject);
        return aReady ? -1 : 1;
      });
      for (const plan of sorted) {
        msg += formatSubjectMastery(plan.evidence.mastery);
        msg += formatIntervention(plan);
        msg += `\n`;
      }
      msg += `_Reply *MY PROGRESS* for your whole-class curriculum coverage._`;

      await safeSendMessage(from, msg);
    } catch (err) {
      console.error('[Workspace] LEARNER PROGRESS error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load that learner's progress. Please try again.`);
    }
    return true;
  }

  // ── WORKSPACE summary ──
  if (upper === 'WORKSPACE') {
    try {
      const classes = getTeacherClasses(hash);
      const assessments = getAssessmentHistory(hash);
      const progress = getTeacherProgressReport(hash);

      let msg = `🏫 *Your Workspace*\n\n`;

      // Classes
      msg += `📚 *Classes:* ${classes.length}\n`;
      if (classes.length > 0) {
        msg += classes.slice(0, 3).map(c => `  • ${c.name}`).join('\n') + '\n';
        if (classes.length > 3) msg += `  _...and ${classes.length - 3} more_\n`;
      } else {
        msg += `  _None yet — reply *NEW CLASS* to add one_\n`;
      }

      // Assessments
      msg += `\n📊 *Assessments analysed:* ${assessments.length}\n`;
      if (assessments.length > 0) {
        const last = assessments[0];
        const avg = last.class_average != null ? `${Math.round(last.class_average)}%` : 'N/A';
        msg += `  Last: ${last.title || 'Untitled'} — class avg ${avg}\n`;
      }

      // Curriculum progress
      if (progress && !progress.error && progress.dataAvailable) {
        msg += `\n📈 *Curriculum coverage:* ${progress.overallCoverage}% (${progress.totalCovered}/${progress.totalExpected} topics)\n`;
      } else if (teacher.grade != null && teacher.subject) {
        msg += `\n📈 *Curriculum coverage:* _Use data-driven assessments to build your progress record_\n`;
      }

      msg += `\n*Quick commands:*\n`;
      msg += `MY CLASSES | MY ASSESSMENTS | MY PROGRESS`;

      await safeSendMessage(from, msg);
    } catch (err) {
      console.error('[Workspace] summary error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load workspace summary. Please try again.`);
    }
    return true;
  }

  // ── CLASS INTERVENTION [selector] / CLASS INTERVENTION PDF [selector] ──
  if (upper.startsWith('CLASS INTERVENTION')) {
    let rest = text.slice('CLASS INTERVENTION'.length).trim();

    // ADR-009 PR14: an optional leading "PDF" token switches this from the
    // WhatsApp-text summary to the downloadable report generated by
    // generateClassInterventionPdf() (PR13). Everything after "PDF" is
    // still just the same class selector — class resolution below is
    // completely unaware of which output format was requested.
    const pdfMatch = rest.match(/^pdf\b\s*/i);
    const wantsPdf = !!pdfMatch;
    const rawSelector = wantsPdf ? rest.slice(pdfMatch[0].length).trim() : rest;

    let classes = [];
    try {
      classes = getTeacherClasses(hash);
    } catch (err) {
      console.error('[Workspace] getTeacherClasses error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load your classes. Please try again.`);
      return true;
    }

    if (classes.length === 0) {
      await safeSendMessage(from,
        `📚 *No classes yet*\n\nCreate one first:\n*NEW CLASS [name] | [learner count]*\n\nExample:\n_NEW CLASS Grade 8B Mathematics | 28_`
      );
      return true;
    }

    let chosenClass = null;

    if (classes.length === 1) {
      chosenClass = classes[0];
    } else if (!rawSelector) {
      await safeSendMessage(from, formatClassSelectionForIntervention(classes, wantsPdf));
      return true;
    } else {
      chosenClass = resolveClassSelector(rawSelector, classes);
      if (!chosenClass) {
        await safeSendMessage(from,
          `⚠️ I couldn't match "${rawSelector}" to one of your classes.\n\n` +
          formatClassSelectionForIntervention(classes, wantsPdf)
        );
        return true;
      }
    }

    if (wantsPdf) {
      await generateAndSendClassInterventionPdf(from, hash, chosenClass, deps);
      return true;
    }

    try {
      const plan = getClassInterventionPlan(hash, chosenClass.id);
      await safeSendMessage(from, formatClassInterventionPlan(chosenClass, plan));
    } catch (err) {
      console.error('[Workspace] getClassInterventionPlan error:', err.message);
      await safeSendMessage(from, `⚠️ Couldn't load the class intervention report. Please try again.`);
    }
    return true;
  }

  // Shouldn't reach here given the isWorkspaceCmd guard, but be safe.
  return true;
}

// ── LEARNER PROGRESS formatting helpers ──

const MASTERY_LABELS = {
  'insufficient-data': 'Not enough data yet',
  'beginning': 'Beginning',
  'developing': 'Developing',
  'secure': 'Secure',
  'advanced': 'Advanced',
};

const MASTERY_EMOJI = {
  'insufficient-data': '❔',
  'beginning': '🌱',
  'developing': '📗',
  'secure': '✅',
  'advanced': '⭐',
};

const TREND_LABELS = {
  'rising': '↗ Improving',
  'falling': '↘ Declining',
  'flat': '→ Stable',
};

/**
 * Renders a single subject's MasteryReport (services/masteryService.js) as
 * a short WhatsApp-friendly block. Pure formatting — reads the report's
 * fields as-is, computes nothing (per ADR-007 §3.3, MasteryService already
 * did the composition/judgement work).
 *
 * @param {import('../services/masteryService').MasteryReport} report
 * @returns {string}
 */
function formatSubjectMastery(report) {
  const emoji = MASTERY_EMOJI[report.masteryLevel] || '❔';
  const label = MASTERY_LABELS[report.masteryLevel] || report.masteryLevel;

  let block = `${emoji} *${report.subject}* — ${label}\n`;

  if (report.masteryLevel === 'insufficient-data') {
    block += `_No assessment or observation data recorded yet for this subject._\n`;
    return block;
  }

  const trend = report.evidence?.progress?.trend;
  if (trend && TREND_LABELS[trend]) {
    block += `Progress: ${TREND_LABELS[trend]}\n`;
  }

  if (report.evidence?.coverage?.dataAvailable && report.evidence.coverage.averagePercentage != null) {
    block += `Coverage: ${Math.round(report.evidence.coverage.averagePercentage)}% of expected CAPS topics\n`;
  }

  if (report.strengths && report.strengths.length > 0) {
    block += `Strengths: ${report.strengths.slice(0, 3).join(', ')}\n`;
  }

  if (report.concerns && report.concerns.length > 0) {
    block += `Focus areas: ${report.concerns.slice(0, 3).join(', ')}\n`;
  }

  return block;
}

const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const PRIORITY_EMOJI = {
  low: '🟢',
  medium: '🟠',
  high: '🔴',
};

/**
 * Renders a single subject's InterventionPlan (services/interventionService.js)
 * as a short WhatsApp-friendly block, appended directly under that subject's
 * formatSubjectMastery() block. Pure formatting — reads the plan's priority
 * and recommendedActions as-is, computes nothing (per ADR-007 §3.3,
 * InterventionService already did the rule/judgement work).
 *
 * Skips insufficient-data subjects: formatSubjectMastery() already tells the
 * teacher there's no data for that subject, so an "insufficient-data ->
 * medium priority, gather more evidence" block underneath would be
 * redundant rather than additive.
 *
 * @param {import('../services/interventionService').InterventionPlan} plan
 * @returns {string}
 */
function formatIntervention(plan) {
  if (plan.evidence.mastery.masteryLevel === 'insufficient-data') return '';

  const emoji = PRIORITY_EMOJI[plan.priority] || '🟠';
  const label = PRIORITY_LABELS[plan.priority] || plan.priority;

  let block = `\n${emoji} *Intervention*\n`;
  block += `Priority: ${label}\n`;

  if (plan.recommendedActions && plan.recommendedActions.length > 0) {
    block += `\nRecommended actions\n`;
    for (const action of plan.recommendedActions) {
      block += `• ${action}\n`;
    }
  }

  return block;
}

// ── CLASS INTERVENTION formatting + class-selector helpers ──

/**
 * Builds the class list/usage prompt shown when CLASS INTERVENTION is sent
 * with no selector and the teacher has 2+ classes. Mirrors
 * utils/classContext.js's numbered-list convention, but CLASS INTERVENTION
 * is stateless (single-message, like LEARNER PROGRESS <name>) rather than
 * a multi-step session, so the teacher re-sends the command with the
 * number or name rather than replying to a pending prompt.
 *
 * @param {Array<{id: number, name: string}>} classes
 * @returns {string}
 */
function formatClassSelectionForIntervention(classes, wantsPdf = false) {
  const cmd = wantsPdf ? 'CLASS INTERVENTION PDF' : 'CLASS INTERVENTION';
  let msg = `📚 *Which class?*\n\n`;
  classes.forEach((c, i) => {
    msg += `${i + 1}. ${c.name}\n`;
  });
  msg += `\n_Reply *${cmd} [number]* or *${cmd} [class name]*._`;
  return msg;
}

/**
 * ADR-009 PR14: generates and sends the downloadable Class Intervention
 * Report (services/pdfService.js's generateClassInterventionPdf(), added
 * in PR13) for an already-resolved class. Single-turn action -- no session
 * state, matching every other read-only workspace command; a failure just
 * means "tell the teacher and let them retry".
 *
 * @param {string} from
 * @param {string} hash
 * @param {{id: number, name: string}} chosenClass
 * @param {object} deps
 */
async function generateAndSendClassInterventionPdf(from, hash, chosenClass, deps) {
  const { generateClassInterventionPdf, buildPdfUrl, sendDocument, safeSendMessage } = deps;

  try {
    const { fileId, filename, error } = await generateClassInterventionPdf(hash, chosenClass.id);
    if (error) {
      await safeSendMessage(from, `⚠️ Couldn't generate the class intervention report: ${error}`);
      return;
    }
    const pdfUrl = buildPdfUrl(fileId);
    await sendDocument(from, pdfUrl, filename,
      `📎 *Class Intervention Report ready!*\n\nPriority breakdown, per-learner detail, and common focus topics for *${chosenClass.name}* are in the PDF above.`);
  } catch (pdfErr) {
    console.error('[Workspace] Class intervention PDF generation failed:', pdfErr.message);
    await safeSendMessage(from, `⚠️ Couldn't generate the class intervention report right now. Please try again.`);
  }
}

/**
 * Generates the learner-level intervention PDF (PR9's
 * generateLearnerInterventionPdf) and sends it as a WhatsApp document.
 * Mirrors generateAndSendClassInterventionPdf(): the "no assessment or
 * observation data yet" case is handled inside generateLearnerInterventionPdf
 * itself via its {error} contract, so this helper doesn't duplicate that
 * check the way the text branch above does.
 *
 * @param {string} from
 * @param {{id: number, canonicalName: string}} learner
 * @param {object} deps
 */
async function generateAndSendLearnerInterventionPdf(from, learner, deps) {
  const { generateLearnerInterventionPdf, buildPdfUrl, sendDocument, safeSendMessage } = deps;

  try {
    const { fileId, filename, error } = await generateLearnerInterventionPdf(learner.id);
    if (error) {
      await safeSendMessage(from, `⚠️ Couldn't generate ${learner.canonicalName}'s progress report: ${error}`);
      return;
    }
    const pdfUrl = buildPdfUrl(fileId);
    await sendDocument(from, pdfUrl, filename,
      `📎 *Learner Progress Report ready!*\n\nMastery levels and intervention notes for *${learner.canonicalName}* are in the PDF above.`);
  } catch (pdfErr) {
    console.error('[Workspace] Learner progress PDF generation failed:', pdfErr.message);
    await safeSendMessage(from, `⚠️ Couldn't generate ${learner.canonicalName}'s progress report right now. Please try again.`);
  }
}

/**
 * Resolves a teacher-typed selector against their class list: a 1-based
 * index into the same order getTeacherClasses() returned, or a
 * case-insensitive substring match on the class name. Returns null when
 * neither resolves so the caller can re-prompt rather than guess.
 *
 * @param {string} rawSelector
 * @param {Array<{id: number, name: string}>} classes
 * @returns {{id: number, name: string}|null}
 */
function resolveClassSelector(rawSelector, classes) {
  const asIndex = parseInt(rawSelector, 10);
  if (Number.isInteger(asIndex) && String(asIndex) === rawSelector.trim() && asIndex >= 1 && asIndex <= classes.length) {
    return classes[asIndex - 1];
  }
  const needle = rawSelector.trim().toLowerCase();
  const matches = classes.filter(c => (c.name || '').toLowerCase().includes(needle));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Renders a ClassInterventionPlan (services/classInterventionService.js)
 * as a WhatsApp-friendly summary. Pure formatting — reads the plan's
 * fields as-is, computes nothing (same discipline formatSubjectMastery()/
 * formatIntervention() apply to their inputs per ADR-007 §3.3):
 * ClassInterventionService already did every aggregation/priority/ranking
 * decision reflected here.
 *
 * @param {{id: number, name: string}} cls
 * @param {import('../services/classInterventionService').ClassInterventionPlan} plan
 * @returns {string}
 */
function formatClassInterventionPlan(cls, plan) {
  const { summary, priorityCounts, commonFocusTopics, priorityLearners } = plan;

  if (summary.totalLearners === 0) {
    return `🏫 *Class Intervention — ${cls.name}*\n\nThis class has no learners recorded yet.\n\n_Add learners before running a class intervention report._`;
  }

  let msg = `🏫 *Class Intervention — ${cls.name}*\n\n`;
  msg += `👥 ${summary.totalLearners} learner(s) | ${summary.evaluatedLearners} evaluated | ${summary.insufficientData} awaiting data\n`;
  if (summary.erroredLearners > 0) {
    msg += `⚠️ ${summary.erroredLearners} learner(s) couldn't be evaluated\n`;
  }
  msg += `\n`;

  msg += `*Priority breakdown*\n`;
  msg += `${PRIORITY_EMOJI.high} High: ${priorityCounts.high}\n`;
  msg += `${PRIORITY_EMOJI.medium} Medium: ${priorityCounts.medium}\n`;
  msg += `${PRIORITY_EMOJI.low} Low: ${priorityCounts.low}\n`;

  const BUCKET_DISPLAY_CAP = 8;
  for (const level of ['high', 'medium', 'low']) {
    const learners = priorityLearners[level];
    if (!learners || learners.length === 0) continue;
    msg += `\n${PRIORITY_EMOJI[level]} *${PRIORITY_LABELS[level]} priority*\n`;
    const shown = learners.slice(0, BUCKET_DISPLAY_CAP);
    for (const l of shown) {
      msg += `• ${l.learnerName}\n`;
    }
    if (learners.length > shown.length) {
      msg += `_...and ${learners.length - shown.length} more_\n`;
    }
  }

  if (commonFocusTopics.length > 0) {
    const TOPIC_DISPLAY_CAP = 5;
    const sorted = [...commonFocusTopics].sort((a, b) => b.percentage - a.percentage);
    msg += `\n*Common focus topics*\n`;
    for (const t of sorted.slice(0, TOPIC_DISPLAY_CAP)) {
      msg += `• ${t.subject} — ${t.topic} (${Math.round(t.percentage * 100)}% of evaluated learners)\n`;
    }
  }

  msg += `\n_Reply *LEARNER PROGRESS [name]* for a specific learner's full breakdown._`;
  return msg;
}

module.exports = {
  handleWorkspaceFlow,
};
