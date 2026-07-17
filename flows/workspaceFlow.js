'use strict';

/**
 * Workspace flow handler — extracted from routes/webhook.js.
 *
 * Covers the read-only / class-management "Teacher Workspace" commands:
 *   NEW CLASS, MY CLASSES, MY ASSESSMENTS / MY ASSESSMENT HISTORY,
 *   MY PROGRESS / MY CURRICULUM PROGRESS, WORKSPACE.
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
  } = deps;

  const upper = text.trim().toUpperCase();

  const isWorkspaceCmd =
    upper === 'MY CLASSES' || upper.startsWith('NEW CLASS') ||
    upper === 'MY ASSESSMENTS' || upper === 'MY ASSESSMENT HISTORY' ||
    upper === 'MY PROGRESS' || upper === 'MY CURRICULUM PROGRESS' ||
    upper === 'WORKSPACE';

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

  // Shouldn't reach here given the isWorkspaceCmd guard, but be safe.
  return true;
}

module.exports = {
  handleWorkspaceFlow,
};
