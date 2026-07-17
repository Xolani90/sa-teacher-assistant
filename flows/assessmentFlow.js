// flows/assessmentFlow.js
// Extracted from routes/webhook.js — handles the "upload marks" multi-turn
// data-assessment flow (CSV / photo / document upload -> parse -> diagnostic
// summary via processAssessmentData()). Dependencies injected via
// buildAssessmentDeps() in webhook.js; no reverse dependency on webhook.js.

async function handleAssessmentFlow(from, text, message = null, preClassifiedIntent = null, deps) {
  const {
    hashPhone,
    safeSendMessage,
    gradeLabel,
    isProActive,
    getTeacherByPhone,
    dataAssessmentState,
    parseMarks,
    extractMarksFromImage,
    getFormatHelpText,
    processAssessmentData,
  } = deps;


  const phoneHash = hashPhone(from);
  let state = dataAssessmentState.get(phoneHash);

  // ── Not mid-flow: check if this is a fresh trigger ──
  if (!state) {
    const intent = preClassifiedIntent || parseIntent(text);
    if (intent.type !== 'dataAssessment') return false;

    // Pro gate — isProActive requires the teacher ROW (it reads teacher.is_pro /
    // teacher.pro_expires), not a phone number. Passing `from` directly always
    // evaluated to false, which meant this entire Pro feature was unreachable
    // for every teacher, including those who had already paid.
    if (!isProActive(getTeacherByPhone(from))) {
      await safeSendMessage(from,
        '📊 Data-driven assessment analysis (item analysis, error analysis, learner grouping) is a *Pro feature*.\n\n' +
        'It gives you facility values, discrimination indices, and full CAPS-aligned diagnostic reports.\n\n' +
        'Reply *UPGRADE* to unlock, or use the conversational *assessment analysis* feature instead.'
      );
      return true;
    }

    // Start the flow — collect metadata first
    dataAssessmentState.set(phoneHash, {
      step: 'awaitingTitle',
      grade: intent.grade ?? null,
      subject: intent.subject || null,
      title: null,
      term: null,
      lastActivity: Date.now(),
    });

    await safeSendMessage(from,
      '📊 *Data-Driven Assessment Analysis*\n\n' +
      'I\'ll run a full item analysis, error analysis, and learner grouping with CAPS-aligned recommendations.\n\n' +
      'First, what is the *title* of this assessment? (e.g. "Term 2 Test", "June Exam")'
    );
    return true;
  }

  // Update activity timestamp
  state = { ...state, lastActivity: Date.now() };

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Allow cancellation at any step
  if (/^(cancel|stop|exit|quit|nevermind|never mind)\b/i.test(trimmed)) {
    dataAssessmentState.delete(phoneHash);
    await safeSendMessage(from, '✅ Data assessment cancelled. What else can I help you with?');
    return true;
  }

  // ── Step: collect assessment title ──
  if (state.step === 'awaitingTitle') {
    state.title = trimmed || 'Assessment';
    state.step = 'awaitingGrade';
    dataAssessmentState.set(phoneHash, state);

    if (state.grade) {
      // Grade already known from trigger phrase — skip straight to subject
      state.step = state.subject ? 'awaitingTerm' : 'awaitingSubject';
      dataAssessmentState.set(phoneHash, state);
      if (state.subject) {
        await safeSendMessage(from, `Which *term* is this assessment for? (1, 2, 3, or 4)`);
      } else {
        await safeSendMessage(from, `Which *subject* is "${state.title}" for?`);
      }
    } else {
      await safeSendMessage(from, `Which *grade* is this assessment for? (e.g. Grade 8, Grade 10)`);
    }
    return true;
  }

  // ── Step: collect grade ──
  if (state.step === 'awaitingGrade') {
    const gradeMatch = trimmed.match(/\b(\d{1,2})\b/);
    if (!gradeMatch) {
      await safeSendMessage(from, 'Please enter the grade number, e.g. "8" or "Grade 10".');
      return true;
    }
    state.grade = parseInt(gradeMatch[1], 10);
    state.step = state.subject ? 'awaitingTerm' : 'awaitingSubject';
    dataAssessmentState.set(phoneHash, state);
    if (state.subject) {
      await safeSendMessage(from, `Which *term* is this for? (1, 2, 3, or 4)`);
    } else {
      await safeSendMessage(from, `Which *subject*?`);
    }
    return true;
  }

  // ── Step: collect subject ──
  if (state.step === 'awaitingSubject') {
    state.subject = trimmed;
    state.step = 'awaitingTerm';
    dataAssessmentState.set(phoneHash, state);
    await safeSendMessage(from, `Which *term*? (1, 2, 3, or 4)`);
    return true;
  }

  // ── Step: collect term ──
  if (state.step === 'awaitingTerm') {
    const termMatch = trimmed.match(/\b([1-4])\b/);
    state.term = termMatch ? parseInt(termMatch[1], 10) : 1;
    state.step = 'awaitingMarks';
    dataAssessmentState.set(phoneHash, state);
    await safeSendMessage(from, getFormatHelpText());
    return true;
  }

  // ── Step: receive marks (text or document) ──
  if (state.step === 'awaitingMarks') {
    let parseResult = null;

    // ── Case 1: Teacher uploaded a document (CSV or Excel) ──
    const isDocument = message && message.type === 'document';
    if (isDocument) {
      const mediaId = message.document?.id;
      const filename = message.document?.filename || '';
      const mimeType = message.document?.mime_type || '';
      const isCsv  = /\.csv$/i.test(filename) || mimeType === 'text/csv' || mimeType === 'text/plain';
      const isXlsx = /\.xlsx?$/i.test(filename) ||
                     mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                     mimeType === 'application/vnd.ms-excel';

      if (!mediaId) {
        await safeSendMessage(from, '⚠️ Could not read the document. Please try sending it again.');
        return true;
      }
      if (!isCsv && !isXlsx) {
        await safeSendMessage(from,
          '⚠️ Please upload a *CSV* (.csv) or *Excel* (.xlsx) file.\n\n' +
          'You can also type marks directly or send a photo of your mark sheet.'
        );
        return true;
      }

      const fileLabel = isXlsx ? 'Excel file' : 'CSV file';
      await safeSendMessage(from, `⏳ Downloading your ${fileLabel}...`);
      try {
        const { buffer } = await downloadMedia(mediaId);
        parseResult = parseMarks(buffer, isXlsx ? 'xlsx' : 'csv');
      } catch (err) {
        console.error('[DataAssessment] Media download failed:', err.message);
        await safeSendMessage(from,
          '⚠️ I couldn\'t download that file. Please try again, or type your marks directly.'
        );
        return true;
      }
    }

    // ── Case 1b: Teacher uploaded an image (photo of mark sheet) ──
    const isImage = message && message.type === 'image';
    if (isImage && !parseResult) {
      const mediaId = message.image?.id;
      const mimeType = message.image?.mime_type || 'image/jpeg';

      if (!mediaId) {
        await safeSendMessage(from, '⚠️ Could not read the image. Please try again.');
        return true;
      }

      await safeSendMessage(from, '📸 Reading your mark sheet... This may take a moment. ⏳');
      try {
        const { buffer } = await downloadMedia(mediaId);
        parseResult = await extractMarksFromImage(buffer, mimeType);
      } catch (err) {
        console.error('[DataAssessment] Image download/vision failed:', err.message);
        await safeSendMessage(from,
          '⚠️ I couldn\'t read the mark sheet from that image. Please try a clearer photo, or upload a CSV/Excel file.'
        );
        return true;
      }
    }

    // ── Case 2: Teacher typed marks inline ──
    if (!parseResult && trimmed) {
      parseResult = parseMarks(trimmed, 'auto');
    }

    // No usable input yet
    if (!parseResult) {
      await safeSendMessage(from,
        'Please type your marks or upload a CSV file.\n\n' + getFormatHelpText()
      );
      return true;
    }

    // Parse errors
    if (parseResult.errors.length > 0) {
      dataAssessmentState.set(phoneHash, state); // keep state
      await safeSendMessage(from,
        '⚠️ *Could not read the marks:*\n\n' +
        parseResult.errors.map(e => `• ${e}`).join('\n') +
        '\n\nPlease correct the format and try again.\n\n' +
        getFormatHelpText()
      );
      return true;
    }

    // Too few learners for meaningful analysis
    if (parseResult.learners.length < 2) {
      await safeSendMessage(from,
        '⚠️ I need at least 2 learners to run a meaningful analysis. Please include all learners and try again.'
      );
      dataAssessmentState.set(phoneHash, state);
      return true;
    }

    // Acknowledge warnings
    if (parseResult.warnings.length > 0) {
      await safeSendMessage(from,
        '⚠️ *Notes on your data:*\n' +
        parseResult.warnings.map(w => `• ${w}`).join('\n') +
        '\n\nContinuing with the analysis...'
      );
    } else {
      await safeSendMessage(from,
        `✅ Received marks for *${parseResult.learners.length} learners* across *${parseResult.questionCount || 0} question(s)*.\n\nRunning full diagnostic analysis — this may take a moment... ⏳`
      );
    }

    // ── Run the diagnostic pipeline ──
    let diagnosticResults;
    try {
      const assessmentData = {
        title: state.title,
        grade: state.grade,
        subject: state.subject,
        term: state.term,
        type: 'test',
        totalMarks: parseResult.totalMark,
        atpTopics: Object.values(parseResult.questionTopics || {}),
        learnerResults: parseResult.learners, // already in { learnerName, mark, totalMarks, questionData } shape
      };
      diagnosticResults = processAssessmentData(phoneHash, assessmentData);
    } catch (err) {
      console.error('[DataAssessment] Pipeline error:', err.message, err.stack);
      dataAssessmentState.delete(phoneHash);
      await safeSendMessage(from,
        '⚠️ Something went wrong during analysis. Please try again or contact support.'
      );
      return true;
    }

    dataAssessmentState.delete(phoneHash);

    if (diagnosticResults.error) {
      await safeSendMessage(from, `⚠️ Analysis failed: ${diagnosticResults.error}`);
      return true;
    }

    // ── Format and send the diagnostic summary (Steps 1–5) ──
    const { analyses } = diagnosticResults;
    const ia = analyses.itemAnalysis;
    const ea = analyses.errorAnalysis;
    const lg = analyses.learnerGrouping;

    let summary = `📊 *Diagnostic Report — ${state.title}*\n`;
    summary += `${gradeLabel(state.grade)} ${state.subject} | Term ${state.term}\n`;
    summary += `${parseResult.learners.length} learners analysed\n\n`;

    // Step 1–2: Item analysis summary
    if (ia && !ia.error) {
      summary += ia.summary + '\n';
      const worst = (ia.questions || [])
        .filter(q => q.difficultyCategory === 'difficult' || q.difficultyCategory === 'very_difficult')
        .slice(0, 3);
      if (worst.length > 0) {
        summary += `*Questions needing reteaching:*\n`;
        worst.forEach(q => {
          const topicLabel = q.topic ? ` (${q.topic})` : '';
          summary += `• Q${q.questionNumber}${topicLabel}: facility value ${(q.facilityValue * 100).toFixed(0)}%, `;
          summary += `${(q.successRate * 100).toFixed(0)}% succeeded\n`;
        });
        summary += '\n';
      }
    }

    // Step 3: Error analysis summary
    if (ea && !ea.error && ea.summary) {
      summary += ea.summary + '\n';
    }

    // Step 5: Learner grouping — remap A/B/C/D → Group 1-4 (spec labels)
    // Group A (80-100%) = Group 4 Advanced
    // Group B (60-79%)  = Group 3 Proficient
    // Group C (40-59%)  = Group 2 Developing
    // Group D (0-39%)   = Group 1 Intensive Support
    const groupData = {};
    if (lg && !lg.error && lg.groups) {
      const g = lg.groups;
      groupData.group4 = { count: (g.A || {}).count || 0, names: ((g.A || {}).learners || []).map(l => l.name) };
      groupData.group3 = { count: (g.B || {}).count || 0, names: ((g.B || {}).learners || []).map(l => l.name) };
      groupData.group2 = { count: (g.C || {}).count || 0, names: ((g.C || {}).learners || []).map(l => l.name) };
      groupData.group1 = { count: (g.D || {}).count || 0, names: ((g.D || {}).learners || []).map(l => l.name) };

      summary += `*👥 Learner Grouping:*\n`;
      summary += `• Group 4 — Advanced (80–100%): ${groupData.group4.count} learner${groupData.group4.count !== 1 ? 's' : ''}\n`;
      summary += `• Group 3 — Proficient (60–79%): ${groupData.group3.count} learner${groupData.group3.count !== 1 ? 's' : ''}\n`;
      summary += `• Group 2 — Developing (40–59%): ${groupData.group2.count} learner${groupData.group2.count !== 1 ? 's' : ''}\n`;
      summary += `• Group 1 — Intensive Support (0–39%): ${groupData.group1.count} learner${groupData.group1.count !== 1 ? 's' : ''}\n`;
      if (lg.classAverage !== undefined) summary += `\n_Class average: ${lg.classAverage}%_\n`;
    } else {
      // Fallback: compute groups from parseResult directly (in case DB pipeline failed)
      const learners = parseResult.learners || [];
      groupData.group4 = { count: 0, names: [] };
      groupData.group3 = { count: 0, names: [] };
      groupData.group2 = { count: 0, names: [] };
      groupData.group1 = { count: 0, names: [] };
      for (const l of learners) {
        const pct = l.totalMarks > 0 ? Math.round((l.mark / l.totalMarks) * 100) : 0;
        if (pct >= 80)      { groupData.group4.count++; groupData.group4.names.push(l.learnerName); }
        else if (pct >= 60) { groupData.group3.count++; groupData.group3.names.push(l.learnerName); }
        else if (pct >= 40) { groupData.group2.count++; groupData.group2.names.push(l.learnerName); }
        else                { groupData.group1.count++; groupData.group1.names.push(l.learnerName); }
      }
    }

    await safeSendMessage(from, summary);

    // Store the assessmentId in profile for REPORT command follow-up
    if (diagnosticResults.assessmentId) {
      updateTeacherProfile(from, { last_assessment_id: String(diagnosticResults.assessmentId) });
    }

    // ── Steps 6–10: AI-powered Intervention Package ──────────────────────────
    await safeSendMessage(from,
      '⏳ *Generating your intervention plan...* (Steps 6–10)\n_This takes 20–30 seconds._'
    );

    // This flow is Pro-gated at entry, so quota is never actually blocking —
    // but every other generateContent() call site records the attempt via
    // checkAndIncrementUsage()/rollbackUsage() so usage_events (and the
    // STATUS command's usage count) stay accurate. This call — the single
    // most expensive prompt in the app (fullInterventionPlan, 8,192-token
    // budget) — was the one path that skipped that logging entirely.
    const quota = checkAndIncrementUsage(from, 'fullInterventionPlan');

    try {
      // Extract weak topics and error patterns for the AI prompt
      const weakTopics = (ia && !ia.error)
        ? (ia.questions || [])
            .filter(q => q.difficultyCategory === 'difficult' || q.difficultyCategory === 'very_difficult')
            .map(q => q.topic || `Question ${q.questionNumber}`)
            .filter(Boolean)
        : [];

      const errorPatterns = (ea && !ea.error && ea.errorPatterns)
        ? ea.errorPatterns.slice(0, 5).map(p => p.description || p.type || String(p))
        : [];

      const classAvg = (lg && lg.classAverage) ? `${lg.classAverage}%` : 'Not calculated';

      const interventionPrompt = buildFullInterventionPlanPrompt({
        grade: state.grade,
        subject: state.subject,
        term: state.term,
        assessmentTitle: state.title,
        classAverage: classAvg,
        weakTopics,
        errorPatterns,
        groups: groupData,
        totalLearners: parseResult.learners.length,
      });

      const interventionResponse = await generateContent(interventionPrompt, 'fullInterventionPlan');

      // Persist the AI plan text so interventionReportsService prefers it over
      // the rules-based fallback when HOD/parent reports are requested later.
      try {
        saveReport(phoneHash, diagnosticResults.assessmentId, 'ai_intervention_plan', interventionResponse);
        // The full diagnostic report (summary + AI plan) is what REPORT sends back
        // as a PDF — save it now so that command doesn't need to regenerate AI content.
        saveReport(phoneHash, diagnosticResults.assessmentId, 'diagnostic', `${summary}\n\n${interventionResponse}`);
      } catch (saveErr) {
        // Non-fatal — teacher already has the content in-chat even if persistence fails.
        console.error('[DataAssessment] Failed to persist report:', saveErr.message);
      }

      // Parse the AI response into sections by delimiter
      const sections = parseInterventionSections(interventionResponse);

      if (sections.step6) {
        await safeSendMessage(from,
          `📋 *Step 6 — Intervention Plan*\n\n${sections.step6.trim()}`
        );
      }
      if (sections.step7) {
        await safeSendMessage(from,
          `🎯 *Step 7 — Differentiated Activities*\n\n${sections.step7.trim()}`
        );
      }
      if (sections.step8) {
        await safeSendMessage(from,
          `🔁 *Step 8 — Reteaching Plan*\n\n${sections.step8.trim()}`
        );
      }
      if (sections.step9) {
        await safeSendMessage(from,
          `📅 *Step 9 — Monitoring Plan*\n\n${sections.step9.trim()}`
        );
      }
      if (sections.step10) {
        await safeSendMessage(from,
          `📄 *Step 10 — Professional Summary*\n\n${sections.step10.trim()}\n\n` +
          `_Reply *REPORT* for the full diagnostic PDF._`
        );
      } else {
        await safeSendMessage(from,
          '📄 *Full report ready.* Reply *REPORT* to receive the diagnostic PDF.\n' +
          'Or ask for *parent report*, *HOD report*, *moderation pack*, or more *differentiated activities*.'
        );
      }
    } catch (aiErr) {
      console.error('[DataAssessment] Steps 6–10 AI error:', aiErr.message);
      rollbackUsage(quota, from);
      // Non-fatal: Steps 1–5 already sent. Persist what we have so REPORT
      // still has real content to send, even without the AI intervention plan.
      try {
        saveReport(phoneHash, diagnosticResults.assessmentId, 'diagnostic', summary);
      } catch (saveErr) {
        console.error('[DataAssessment] Failed to persist fallback report:', saveErr.message);
      }
      await safeSendMessage(from,
        '📄 *Intervention plan ready.* Reply *REPORT* to receive the full diagnostic PDF with:\n' +
        '• Complete item analysis table\n' +
        '• Error analysis by CAPS topic\n' +
        '• Intervention plan for each learner group\n' +
        '• Reteaching recommendations\n\n' +
        'Or ask for a *parent report*, *HOD report*, *moderation pack*, or *differentiated activities*.'
      );
    }

    return true;
  }

  return false;
}

module.exports = { handleAssessmentFlow };
