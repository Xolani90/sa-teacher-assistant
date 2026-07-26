// core/commandHandler.js
// Extracted from routes/webhook.js — handles special keyword commands
// (STOP, PRO/UPGRADE, STATUS/USAGE/BALANCE, HELP/MENU/HI/HELLO, PROFILE,
// UPDATE, RETRY, workspace commands (MY CLASSES/MY ASSESSMENTS/MY PROGRESS/
// WORKSPACE/NEW CLASS), CANCEL of a pending SAVE, SAVE, REPORT/HOD REPORT/
// PARENT REPORT, worksheet-adaptation commands, and TRANSLATE). Returns
// true if the command was handled (skip normal message processing), false
// otherwise. Dependencies injected via buildCommandDeps() in webhook.js;
// no reverse dependency on webhook.js.

'use strict';

/**
 * Handles special keyword commands.
 * Returns true if the command was handled (skip normal processing).
 *
 * @param {string} from
 * @param {string} text
 * @param {Object} deps
 * @returns {Promise<boolean>}
 */
async function handleCommand(from, text, deps) {
  const upper = text.toUpperCase().trim();

  // ── STOP (opt-out) ───────────────────────────────────────────
  if (upper === 'STOP') {
    deps.updateTeacherProfile(from, { opted_out: 1 });
    const db = require('../utils/database').getDb();
    // Record the exact time of opt-out for reliable re-activation detection.
    // opted_out_at is always set on STOP and cleared on re-activation — unlike
    // renewal_reminder_sent_at which is managed independently by Pro billing logic.
    db.prepare(`UPDATE teachers SET opted_out_at = datetime('now') WHERE phone_hash = ?`).run(deps.hashPhone(from));
    deps.clearAllSessions(from);
    await deps.sendMessage(from,
      `Got it — you've been unsubscribed. Send me any message whenever you'd like to start again. 👋`
    );
    console.log(`[WEBHOOK] Teacher ...${String(from).slice(-4)} opted out via STOP`);
    return true;
  }

  // ── PRO upgrade ──────────────────────────────────────────────
  if (upper === 'PRO' || upper === 'UPGRADE') {
    try {
      const teacher    = deps.getTeacherByPhone(from);
      const teacherName = teacher?.name || '';
      const { redirectUrl: url } = await deps.buildPaymentUrl(from, teacherName);

      await deps.safeSendMessage(from,
        `🌟 *Pro — R${process.env.PRO_PRICE_ZAR || 99}/month*\n\n` +
        `✅ Unlimited generations, no monthly cap\n` +
        `✅ Annual Teaching Plans for any grade & subject\n` +
        `✅ Worksheets, tests, lesson plans, explanations\n` +
        `✅ PDF download for every document\n` +
        `✅ Cancel any time\n\n` +
        `👇 *Tap to pay securely via Yoco:*\n${url}\n\n` +
        `_Activates the moment payment goes through._`
      );
    } catch (err) {
      console.error('[WEBHOOK] Failed to build payment URL:', err.message);
      await deps.safeSendMessage(from,
        `Something went wrong generating your payment link. Give it another try in a moment — sorry about that!`
      );
    }
    return true;
  }

  // ── Usage / status ────────────────────────────────────────────
  if (upper === 'STATUS' || upper === 'USAGE' || upper === 'BALANCE') {
    const info = deps.getUsageInfo(from);
    const teacher = deps.getTeacherByPhone(from);
    if (info.isPro) {
      const expiryDate = teacher?.pro_expires ? new Date(teacher.pro_expires) : null;
      const formattedExpiry = expiryDate ? expiryDate.toLocaleDateString('en-ZA', {
        day: 'numeric', month: 'long', year: 'numeric',
      }) : 'No expiry';
      await deps.safeSendMessage(from,
        `✅ *Pro* — unlimited generations until ${formattedExpiry} 🎓\n\nYou're all set — just ask for anything you need.`
      );
    } else {
      const remaining = info.remaining ?? 0;
      const reset = new Date();
      reset.setMonth(reset.getMonth() + 1, 1);
      const resetStr = reset.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
      await deps.safeSendMessage(from,
        `📊 *This month* — ${info.count} of ${info.limit} free generations used, ${remaining} left. Resets ${resetStr}.\n\n` +
        (remaining === 0
          ? `You've used up your free generations for the month.\n\nReply *PRO* to go unlimited (R${process.env.PRO_PRICE_ZAR || 99}/month). 🚀`
          : `Reply *PRO* to go unlimited for R${process.env.PRO_PRICE_ZAR || 99}/month.`
        )
      );
    }
    return true;
  }

  // ── Help menu ─────────────────────────────────────────────────
  if (upper === 'HELP' || upper === 'MENU' || upper === 'HI' || upper === 'HELLO') {
    // MENU/HELP must behave like an implicit CANCEL for any in-progress flow.
    // Previously this branch returned early without touching session state,
    // so an abandoned flow (e.g. mid data-assessment) stayed alive. The next
    // unrelated message (e.g. "Upload marks" sent again) would then either
    // get swallowed by the stale flow's step handler, or — once that state
    // finally expired/desynced — get misclassified by the generic intent
    // parser (which has no notion of "was mid data-assessment"). Clearing
    // sessions here, same as STOP already does, ensures MENU always returns
    // the teacher to a clean slate.
    deps.clearAllSessions(from);

    const teacher = deps.getTeacherByPhone(from);
    const name    = teacher?.name || 'there';
    await deps.safeSendMessage(from,
      `👋 Hey ${name}! Here's what I can do:\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `📝 *1. CREATE A RESOURCE*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `Just describe what you need, e.g.:\n` +
      `_"Grade 7 Maths worksheet on fractions"_\n` +
      `_"30-mark test on photosynthesis, Grade 9"_\n` +
      `_"Lesson plan, Grade 10 Accounting"_\n` +
      `_"Rubric for persuasive essay"_\n` +
      `_"Quick quiz on the water cycle"_\n` +
      `_"Explain long division simply"_\n` +
      `_"Parent message: Thabo absent 3 days"_\n` +
      `_"Report comment for Lindiwe, Term 2"_\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `📊 *2. SUBMIT & ANALYSE MARKS*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `_"Upload marks"_ — submit a mark sheet (type, photo, CSV or Excel) for full item analysis, error analysis & learner grouping\n` +
      `_"How did my class do?"_ — quick assessment analysis\n` +
      `_"Intervention plan for my strugglers"_\n` +
      `_"Moderation pack for HOD sign-off"_\n\n` +
      `After uploading, reply:\n` +
      `*REPORT* — full diagnostic PDF\n` +
      `*HOD REPORT* — for department submission\n` +
      `*PARENT REPORT* — for one learner or class\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `👁️ *3. CLASSROOM OBSERVATIONS*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `_"Observe my class"_ — start a play-based / structured observation\n` +
      `*MY OBSERVATIONS* — view your observation history\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `📅 *4. CURRICULUM & PLANNING*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `_"Annual teaching plan for Grade 8 Maths"_ — CAPS ATP\n` +
      `_"Am I behind on the curriculum?"_ — pacing check\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `🏫 *5. YOUR WORKSPACE*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `*WORKSPACE* — classes, assessments & progress\n` +
      `*MY CLASSES* — list classes (NEW CLASS to add)\n` +
      `*MY ASSESSMENTS* — history with averages\n` +
      `*MY PROGRESS* — CAPS curriculum coverage\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *6. YOUR ACCOUNT*\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `*STATUS* — usage & plan\n` +
      `*PRO* — upgrade to Pro (unlocks ATP, analysis, intervention plans & moderation packs)\n` +
      `*PROFILE* — view your defaults\n` +
      `*UPDATE* — change your defaults\n\n` +
      `💡 _After a worksheet, reply_ *EASIER · HARDER · VISUAL · ORAL* _to adapt it._\n\n` +
      `Type anything to get started, or reply *MENU* any time to see this again. 😊`
    );
    return true;
  }

  // ── Profile view ──────────────────────────────────────────────
  if (upper.startsWith('PROFILE')) {
    const info    = deps.getUsageInfo(from);
    const teacher = deps.getTeacherByPhone(from);
    await deps.safeSendMessage(from,
      `👤 *Your Profile*\n\n` +
      `Name: ${teacher?.name || 'Not set'}\n` +
      `Grade: ${teacher?.grade != null ? deps.gradeLabel(teacher.grade) : 'Not set'}\n` +
      `Subject: ${teacher?.subject || 'Not set'}\n` +
      `Language: ${teacher?.language || 'Not set'}\n` +
      `School: ${teacher?.school || 'Not set'}\n` +
      `Plan: ${info.isPro ? '⭐ Pro' : `Free (${info.remaining} remaining)`}\n\n` +
      `_I use your grade and subject as defaults when you don't specify them._\n\n` +
      `Reply *UPDATE* to change any of these.`
    );
    return true;
  }

  // ── UPDATE profile ──────────────────────────────────────────────
  if (upper === 'UPDATE') {
    const phoneHash = deps.hashPhone(from);
    deps.profileUpdateState.set(phoneHash, {
      step: 'ask_field',
      lastActivity: Date.now(),
    });
    await deps.safeSendMessage(from,
      `Sure — what would you like to update?\n\n` +
      `1️⃣ Grade\n` +
      `2️⃣ Subject\n` +
      `3️⃣ School\n` +
      `4️⃣ Language\n\n` +
      `Just reply with the number.`
    );
    return true;
  }

  // ── RETRY last generation ─────────────────────────────────────────
  if (upper === 'RETRY') {
    const teacher = deps.getTeacherByPhone(from);
    if (!teacher || !teacher.last_intent) {
      await deps.safeSendMessage(from, `No previous generation to retry. Send me a request to generate something new.`);
      return true;
    }

    try {
      const lastIntent = JSON.parse(teacher.last_intent);
      // If it's a quick quiz, add a flag to generate different questions
      if (lastIntent.type === 'quickQuiz') {
        lastIntent.regenerate = true;
      }
      await deps.safeSendMessage(from, `🔄 Regenerating your last request...`);
      await deps.triggerGeneration({ from, intent: lastIntent, deps: deps.buildGenerationDeps() });
    } catch (err) {
      console.error('[WEBHOOK] Failed to parse last_intent:', err.message);
      await deps.safeSendMessage(from, `I couldn't find your last request to regenerate — try sending it again from scratch.`);
    }
    return true;
  }

  // ── Teacher Workspace commands ─────────────────────────────────────────────
  // MY CLASSES  — list the teacher's classes; NEW CLASS creates one
  // MY ASSESSMENTS — recent assessment history with class averages
  // MY PROGRESS  — curriculum coverage from real persisted data (or calendar estimate)
  // WORKSPACE   — brief summary combining all three
  //
  // These are read-only views of data that already exists in the DB (written by the
  // data-driven assessment flow). No Pro gate — useful to any registered teacher.
  const { handleWorkspaceFlow } = require('../flows/workspaceFlow');

  function buildWorkspaceDeps() {
    const {
      getTeacherClasses,
      createClass,
      getAssessmentHistory,
      validateNewClassInput,
    } = require('../services/teacherWorkspaceService');
    const { getTeacherProgressReport } = require('../services/curriculumCoverageService');
    const { handleCurriculumQuery: calendarQuery } = require('../services/curriculumIntelligenceService');
    const { searchLearnersByName } = require('../services/learnerRepository');
    const { getLearnerMastery } = require('../services/masteryService');

    return Object.freeze({
      hashPhone: deps.hashPhone,
      getTeacherByPhone: deps.getTeacherByPhone,
      safeSendMessage: deps.safeSendMessage,
      gradeLabel: deps.gradeLabel,
      getTeacherClasses,
      createClass,
      getAssessmentHistory,
      validateNewClassInput,
      getTeacherProgressReport,
      calendarQuery,
      searchLearnersByName,
      getLearnerMastery,
    });
  }

  if (await handleWorkspaceFlow(from, text, buildWorkspaceDeps())) return true;

  // ── CANCEL a pending SAVE prompt ────────────────────────────────────────
  // deps.lastGeneratedState isn't in the `alreadyMidFlow` set (it's not a
  // multi-step conversation, just a one-shot "reply SAVE to keep this")
  // so a bare "Cancel" after generation previously fell straight through
  // to generic classification, which has no idea a save prompt exists and
  // responded with a confusing "did you mean to cancel something?" check-in.
  // Recognize it explicitly here, same as every other CANCEL-able flow.
  if (upper === 'CANCEL') {
    const phoneHash = deps.hashPhone(from);
    const last = deps.lastGeneratedState.get(phoneHash);
    if (last && last.saveState === 'GENERATED') {
      deps.lastGeneratedState.delete(phoneHash);
      await deps.safeSendMessage(from, `👍 No problem — not saved. What else can I help you with?`);
      return true;
    }
  }

  const isWorkspaceCmd =
    upper === 'MY RESOURCES' ||
    upper === 'SAVE';

  if (isWorkspaceCmd) {
    const {
      saveResource,
      getSavedResources,
      getSavedResourceByGenerationId,
    } = require('../services/teacherWorkspaceService');

    // ── SAVE ──────────────────────────────────────────────────────────────────
    if (upper === 'SAVE') {
      const phoneHash = deps.hashPhone(from);
      const last = deps.lastGeneratedState.get(phoneHash);

      if (!last) {
        await deps.safeSendMessage(from,
          `Nothing to save yet — generate a resource first (worksheet, test, lesson plan, etc.), then reply *SAVE* immediately after.`
        );
        return true;
      }

      // B5-F1 (R2) / C2-F1: per-phone deps.saveLock — checked before BOTH the
      // RECOVERABLE retry path and the GENERATED→INSERT path below, since
      // the RECOVERABLE branch also awaits a WhatsApp send and must not be
      // re-entered by a second SAVE landing in that window. Released
      // unconditionally in the finally block of the GENERATED path; the
      // RECOVERABLE path below releases it manually since it returns before
      // reaching that try/finally.
      if (deps.saveLock.has(phoneHash)) {
        console.warn(`[Workspace] SAVE: in-flight lock active for ${phoneHash.slice(-6)} -- rejecting concurrent call.`);
        await deps.safeSendMessage(from, `Your save is already in progress -- please wait a moment and try again.`);
        return true;
      }

      // ── Idempotency check (B3-F5 / B4-F4): use explicit saveState tag rather
      // than property-presence inference (B4-R1 fix).
      // RECOVERABLE = DB committed, WhatsApp delivery failed.  Reconstruct
      // the confirmation from session state without issuing a second INSERT.
      if (last.saveState === 'RECOVERABLE') {
        deps.saveLock.add(phoneHash);
        const gradeStr2   = last.intent.grade != null                                  ? ` · ${deps.gradeLabel(last.intent.grade)}`   : '';
        const subjectStr2 = last.intent.subject && last.intent.subject !== 'general'   ? ` · ${last.intent.subject}`       : '';
        const topicPart2  = last.intent.topic ? last.intent.topic : 'Untitled';
        const typeLabel2  = deps.intentLabel(last.intent.type);
        const title2      = `${topicPart2} — ${typeLabel2}`;
        try {
          await deps.safeSendMessage(from,
            `✅ *Saved!*\n\n📄 *${title2}*${gradeStr2}${subjectStr2}\n\nReply *MY RESOURCES* to see all your saved resources.\n_Resource #${last.lastSavedId}_`
          );
          deps.lastGeneratedState.delete(phoneHash);
          console.log(`[Workspace] Resource #${last.lastSavedId} re-confirmed on retry (generationId: ${last.generationId || 'n/a'})`);
        } catch (sendErr) {
          // WhatsApp still down — keep RECOVERABLE state for next retry attempt.
          console.error('[Workspace] retry confirmation send failed:', sendErr.message);
        } finally {
          deps.saveLock.delete(phoneHash);
        }
        return true;
      }

      // B4-R3 / F5: malformed state guard
      if (!last.generationId) {
        console.warn('[Workspace] SAVE: malformed state (no generationId) -- clearing and treating as IDLE.');
        deps.lastGeneratedState.delete(phoneHash);
        await deps.safeSendMessage(from,
          `Nothing to save yet -- generate a resource first (worksheet, test, lesson plan, etc.), then reply *SAVE* immediately after.`
        );
        return true;
      }

      // B5-F3 (R3): Illegal transition guard.
      // Only GENERATED state is a valid origin for the INSERT path.
      if (last.saveState !== 'GENERATED') {
        console.warn(`[Workspace] SAVE: illegal transition from state '${last.saveState}' -- clearing state.`);
        deps.lastGeneratedState.delete(phoneHash);
        await deps.safeSendMessage(from,
          `Nothing to save yet -- generate a resource first (worksheet, test, lesson plan, etc.), then reply *SAVE* immediately after.`
        );
        return true;
      }

      // B5-F1 (R2): deps.saveLock already checked above (covers both RECOVERABLE
      // and GENERATED paths) — no second check needed here.

      // Build title
      const typeLabel = deps.intentLabel(last.intent.type);
      const topicPart = last.intent.topic ? last.intent.topic : 'Untitled';
      const title = topicPart + ' — ' + typeLabel;

      // Build rich metadata
      const meta = {
        grade:           last.intent.grade ?? null,
        subject:         last.intent.subject  !== 'general' ? last.intent.subject : null,
        topic:           last.intent.topic    || null,
        intent:          last.intent.type,
        term:            last.intent.term     || null,
        atpTopic:        last.intent.atpTopic || null,
        differentiation: last.intent.differentiation || null,
        savedAt:         new Date().toISOString(),
      };

      deps.saveLock.add(phoneHash);
      try {
        // B5-F2 (R4): CAS re-read before INSERT.
        // The path from `last = get()` to here is synchronous for a GENERATED state,
        // so this guard will not fire today. It exists to prevent silent stale-content
        // saves if a future await is added before this point.
        const current = deps.lastGeneratedState.get(phoneHash);
        if (!current || current.generationId !== last.generationId) {
          console.warn(
            `[Workspace] SAVE: CAS mismatch -- state was overwritten while SAVE was running. ` +
            `captured=${last.generationId}, current=${current ? current.generationId : 'null'}`
          );
          await deps.safeSendMessage(from,
            `Your content was updated while saving was in progress -- reply *SAVE* again to save the latest version.`
          );
          return true;
        }

        // B5-F3 (R1): Tag SAVING before INSERT so the full
        // GENERATED -> SAVING -> RECOVERABLE -> SAVED machine is honoured.
        // saveResource() is synchronous so SAVING is never externally observable,
        // but it is testable and makes the invariant explicit.
        deps.lastGeneratedState.set(phoneHash, Object.assign({}, last, { saveState: 'SAVING' }));
        console.log(`[Workspace] State -> SAVING (generationId: ${last.generationId})`);

        // Pass generationId so the DB row carries the idempotency key.
        const saved = saveResource(phoneHash, last.intent.type, title, last.content, meta, last.generationId);

        // DB committed. Tag RECOVERABLE immediately.
        deps.lastGeneratedState.set(phoneHash, Object.assign({}, last, { saveState: 'RECOVERABLE', lastSavedId: saved.id }));
        console.log(`[Workspace] State -> RECOVERABLE (resourceId: ${saved.id}, generationId: ${last.generationId})`);

        const gradeStr   = meta.grade != null ? ` · ${deps.gradeLabel(meta.grade)}`  : '';
        const subjectStr = meta.subject ? ` · ${meta.subject}`      : '';
        await deps.safeSendMessage(from,
          `Saved!\n\n${title}${gradeStr}${subjectStr}\n\nReply *MY RESOURCES* to see all your saved resources.\n_Resource #${saved.id}_`
        );
        deps.lastGeneratedState.delete(phoneHash);
        console.log(`[Workspace] State -> SAVED (resourceId: ${saved.id}, generationId: ${last.generationId})`);
      } catch (err) {
        const isConstraintViolation = err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          (err.message && err.message.includes('UNIQUE constraint failed'));

        if (isConstraintViolation && last.generationId) {
          console.warn(`[Workspace] UNIQUE constraint on retry -- looking up committed row for generationId: ${last.generationId}`);
          const committed = getSavedResourceByGenerationId(last.generationId, phoneHash);
          if (committed) {
            deps.lastGeneratedState.set(phoneHash, Object.assign({}, last, { saveState: 'RECOVERABLE', lastSavedId: committed.id }));
            try {
              const gradeStr   = meta.grade != null ? ` · ${deps.gradeLabel(meta.grade)}`  : '';
              const subjectStr = meta.subject ? ` · ${meta.subject}`      : '';
              await deps.safeSendMessage(from,
                `Saved!\n\n${title}${gradeStr}${subjectStr}\n\nReply *MY RESOURCES* to see all your saved resources.\n_Resource #${committed.id}_`
              );
              deps.lastGeneratedState.delete(phoneHash);
              console.log(`[Workspace] Constraint-recovery confirmation sent (resourceId: ${committed.id})`);
            } catch (sendErr) {
              console.error('[Workspace] constraint-recovery send failed:', sendErr.message);
            }
            return true;
          }
        }

        console.error('[Workspace] SAVE error:', err.message);
        // Roll back SAVING tag on DB failure so retry can proceed.
        const stateAfterError = deps.lastGeneratedState.get(phoneHash);
        if (stateAfterError && stateAfterError.saveState === 'SAVING') {
          deps.lastGeneratedState.set(phoneHash, Object.assign({}, last, { saveState: 'GENERATED' }));
          console.warn('[Workspace] SAVE: DB error -- rolled back SAVING -> GENERATED for retry.');
        }
        try {
          await deps.safeSendMessage(from, `Couldn't save the resource right now. Please try again.`);
        } catch (sendErr) {
          console.error('[Workspace] SAVE error-path send also failed:', sendErr.message);
        }
      } finally {
        // B5-F1: release lock unconditionally.
        deps.saveLock.delete(phoneHash);
      }
      return true;
    }

    // ── MY RESOURCES ──────────────────────────────────────────────────────────
    if (upper === 'MY RESOURCES') {
      const phoneHash = deps.hashPhone(from);
      try {
        const resources = getSavedResources(phoneHash);

        if (resources.length === 0) {
          await deps.safeSendMessage(from,
            `📂 *My Resources*\n\nYou haven't saved any resources yet.\n\nGenerate something and reply *SAVE* to keep it here for easy reference.`
          );
          return true;
        }

        // Show last 8, grouped by type when there are more than 4
        const recent = resources.slice(0, 8);
        const useGroups = recent.length > 4;

        let msg = `📂 *My Resources* (${resources.length} saved)\n\n`;

        if (useGroups) {
          // Group by resource_type
          const grouped = {};
          for (const r of recent) {
            const t = r.resource_type || 'other';
            if (!grouped[t]) grouped[t] = [];
            grouped[t].push(r);
          }
          for (const [type, items] of Object.entries(grouped)) {
            msg += `*${deps.intentLabel(type).charAt(0).toUpperCase() + deps.intentLabel(type).slice(1)}s*\n`;
            for (const r of items) {
              // grade/subject are stored as top-level columns — no JSON parse needed.
              const gradeStr   = r.grade != null ? ` · Gr ${r.grade === 0 ? 'R' : r.grade}` : '';
              const subjectStr = r.subject ? ` · ${r.subject}`  : '';
              const date = r.created_at ? r.created_at.slice(0, 10) : '';
              // ID shown so a future OPEN N command can reference it
              msg += `  [${r.id}] ${r.title}${gradeStr}${subjectStr} · ${date}\n`;
            }
            msg += '\n';
          }
        } else {
          for (const r of recent) {
            const gradeStr   = r.grade != null ? ` · Gr ${r.grade === 0 ? 'R' : r.grade}` : '';
            const subjectStr = r.subject ? ` · ${r.subject}`  : '';
            const date = r.created_at ? r.created_at.slice(0, 10) : '';
            msg += `[${r.id}] ${r.title}${gradeStr}${subjectStr} · ${date}\n`;
          }
        }

        if (resources.length > 8) {
          msg += `_...and ${resources.length - 8} more_\n`;
        }

        msg += `\n_Reply *SAVE* after any generation to add to this list._`;

        await deps.safeSendMessage(from, msg);
      } catch (err) {
        console.error('[Workspace] getSavedResources error:', err.message);
        await deps.safeSendMessage(from, `⚠️ Couldn't load your resources right now. Please try again.`);
      }
      return true;
    }

    return true; // Shouldn't reach here given isWorkspaceCmd guard, but be safe
  }

  // ── REPORT / HOD report / parent report (follow-up to data-driven assessment) ──
  // All three pull the most recently analysed assessment (teacher.last_assessment_id)
  // unless the teacher names a specific learner for a parent report.

  // Classified once into a single reportCommand value so the outer gate and the
  // inner dispatch can never drift out of sync with each other.
  const parentReportMatch = text.trim().match(/^(parent report|parentreport)(\s+for\s+(.+))?$/i);
  const reportCommand =
    /^(report|full report)$/i.test(upper)      ? 'diagnostic' :
    /^(hod|hod report|hodreport)$/i.test(upper) ? 'hod' :
    parentReportMatch                           ? 'parent' :
    null;

  if (reportCommand) {
    const teacher = deps.getTeacherByPhone(from);
    if (!teacher || !teacher.last_assessment_id) {
      await deps.safeSendMessage(from,
        `I don't have a recent assessment to report on. Upload marks or run a data-driven assessment analysis first, then ask me for a report.`
      );
      return true;
    }

    if (!deps.isProActive(teacher)) {
      await deps.safeSendMessage(from,
        `⭐ *Diagnostic, HOD, and parent reports are a Pro feature*\n\n` +
        `Upgrade to Pro for R${process.env.PRO_PRICE_ZAR || 99}/month to unlock these, plus unlimited generations and PDF downloads.\n\n` +
        `Reply *PRO* to upgrade. 🎓`
      );
      return true;
    }

    const assessmentId = teacher.last_assessment_id;
    const assessmentLabel = require('../utils/database').getDb()
      .prepare(`SELECT title, grade, subject FROM assessments WHERE id = ?`)
      .get(assessmentId) || {};

    // ── Bare REPORT: full diagnostic PDF ──
    if (reportCommand === 'diagnostic') {
      const saved = deps.getSavedReport(assessmentId, 'diagnostic');
      const content = saved ? saved.content : deps.generateTeacherSummary(deps.generateInterventionReport(assessmentId));
      await deps.safeSendMessage(from, `⏳ Preparing your diagnostic report PDF...`);
      try {
        const { fileId, filename } = await deps.generatePdf({
          content,
          type: 'diagnosticReport',
          topic: assessmentLabel.title,
          grade: assessmentLabel.grade != null ? deps.gradeLabel(assessmentLabel.grade) : '',
          subject: assessmentLabel.subject,
          school: teacher.school || '',
        });
        const pdfUrl = deps.buildPdfUrl(fileId);
        await deps.sendDocument(from, pdfUrl, filename, `📎 *Diagnostic Report PDF* (available for 2 hours)`);
      } catch (pdfErr) {
        console.error('[WEBHOOK] Diagnostic report PDF generation failed:', pdfErr.message);
        await deps.safeSendMessage(from, content); // Fall back to plain text if PDF fails
      }
      return true;
    }

    // ── HOD report ──
    if (reportCommand === 'hod') {
      const saved = deps.getSavedReport(assessmentId, 'hod');
      let content;
      if (saved) {
        content = saved.content;
      } else {
        const report = deps.generateInterventionReport(assessmentId);
        content = deps.generateHodSummary(report);
        try { deps.saveReport(deps.hashPhone(from), assessmentId, 'hod', content); } catch {}
      }
      await deps.safeSendMessage(from, content);
      await deps.safeSendMessage(from, `_Want this as a PDF to forward? Reply *REPORT* for the full PDF version._`);
      return true;
    }

    // ── Parent report (optionally for a named learner) ──
    if (reportCommand === 'parent') {
      const learnerName = parentReportMatch[3] ? parentReportMatch[3].trim() : null;
      const saved = deps.getSavedReport(assessmentId, 'parent', learnerName);
      let content;
      if (saved) {
        content = saved.content;
      } else {
        const report = deps.generateInterventionReport(assessmentId);
        content = deps.generateParentSummary(report, learnerName);
        try { deps.saveReport(deps.hashPhone(from), assessmentId, 'parent', content, learnerName); } catch {}
      }
      await deps.safeSendMessage(from, content);
      if (!learnerName) {
        await deps.safeSendMessage(from, `_Tip: ask "parent report for [learner name]" for a report scoped to one learner._`);
      }
      return true;
    }
  }

  if (upper === 'WORKSHEET') {
    const phoneHash = deps.hashPhone(from);
    const pending = deps.pendingIntentState.get(phoneHash);
    if (pending) {
      const intent = { ...pending.intent, type: 'worksheet' };
      deps.pendingIntentState.delete(phoneHash);
      await deps.triggerGeneration({ from, intent, deps: deps.buildGenerationDeps() });
    } else {
      await deps.safeSendMessage(from, `What topic should the worksheet cover? Just send me a request like: "Grade 7 fractions worksheet"`);
    }
    return true;
  }

  // ── TEST command (from disambiguation follow-up) ─────────────────────
  if (upper === 'TEST') {
    const phoneHash = deps.hashPhone(from);
    const pending = deps.pendingIntentState.get(phoneHash);
    if (pending) {
      const intent = { ...pending.intent, type: 'test' };
      deps.pendingIntentState.delete(phoneHash);
      await deps.triggerGeneration({ from, intent, deps: deps.buildGenerationDeps() });
    } else {
      await deps.safeSendMessage(from, `What topic should the test cover? Just send me a request like: "Grade 7 fractions test"`);
    }
    return true;
  }

  // ── LESSONPLAN command (from disambiguation follow-up) ─────────────────
  if (upper === 'LESSONPLAN') {
    const phoneHash = deps.hashPhone(from);
    const pending = deps.pendingIntentState.get(phoneHash);
    if (pending) {
      const intent = { ...pending.intent, type: 'lessonPlan' };
      deps.pendingIntentState.delete(phoneHash);
      await deps.triggerGeneration({ from, intent, deps: deps.buildGenerationDeps() });
    } else {
      await deps.safeSendMessage(from, `What topic should the lesson plan cover? Just send me a request like: "Grade 7 fractions lesson plan"`);
    }
    return true;
  }

  // ── Worksheet differentiation commands (EASIER/HARDER/VISUAL/ORAL) — extracted ─
  if (await deps.handleWorksheetFlow(from, text, deps.buildWorksheetDeps())) return true;

  // ── FORMAL command (parent message) ────────────────────────────────
  if (upper === 'FORMAL') {
    const phoneHash = deps.hashPhone(from);
    const state = deps.parentMessageState.get(phoneHash);
    if (!state || !state.lastContent) {
      await deps.safeSendMessage(from, `Generate a parent message first, then reply FORMAL.`);
      return true;
    }
    const formalQuota = deps.checkAndIncrementUsage(from, 'parentMessage');
    if (!formalQuota.allowed) {
      await deps.safeSendMessage(from,
        `You've hit your free limit (${deps.FREE_LIMIT_DISPLAY()} generations/month). Reply *PRO* to keep going — R${process.env.PRO_PRICE_ZAR || 99}/month. 🚀`
      );
      return true;
    }
    await deps.safeSendMessage(from, `⏳ Generating formal letter version...`);
    try {
      const prompt = deps.buildPrompt({
        type: 'parentMessage',
        situation: state.situation,
        learnerName: state.learnerName,
        grade: state.grade,
        subject: state.subject,
        language: state.language,
        teacherName: state.teacherName,
        school: state.school,
        formal: true,
      }, {});
      const content = await deps.generateContent(prompt, 'parentMessage');
      await deps.safeSendMessage(from, content);
      deps.parentMessageState.delete(phoneHash);
    } catch (err) {
      console.error('[WEBHOOK] Formal letter generation failed:', err.message);
      deps.rollbackUsage(formalQuota, from);
      await deps.safeSendMessage(from, `❌ *Generation failed*\n\nSomething went wrong. Please try again.`);
    }
    return true;
  }

  // ── TRANSLATE command (parent message) ─────────────────────────────
  if (upper === 'TRANSLATE') {
    const phoneHash = deps.hashPhone(from);
    const state = deps.parentMessageState.get(phoneHash);
    if (!state || !state.lastContent) {
      await deps.safeSendMessage(from, `Generate a parent message first, then reply TRANSLATE.`);
      return true;
    }
    state.step = 'ask_translation_language';
    state.lastActivity = Date.now();
    deps.parentMessageState.set(phoneHash, state);
    await deps.safeSendMessage(from, `Which language? (Zulu, Xhosa, Afrikaans, Sotho, Tswana)`);
    return true;
  }

  return false; // Not a command — process normally
}


module.exports = { handleCommand };
