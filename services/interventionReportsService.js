'use strict';

/**
 * Intervention Reports Service
 *
 * Formats already-computed diagnostic data (item analysis, error analysis,
 * learner grouping, and — where available — the AI-generated intervention
 * plan from the data-driven assessment flow) into report documents teachers
 * can send on as a diagnostic report, an HOD report, or a parent report.
 *
 * This service does NOT re-derive an intervention plan from scratch. The
 * data-driven assessment flow (routes/webhook.js handleDataAssessmentFlow)
 * already generates a real, AI-written intervention plan via the
 * fullInterventionPlan prompt and saves it to the reports table as a
 * 'diagnostic' report. generateInterventionReport() reads that text back in
 * if present. Only when no AI plan has been saved does it fall back to
 * interventionPlanService's rules-based plan, so teachers always see the
 * best available content rather than a mechanically-downgraded version.
 */

const { getDb } = require('../utils/database');
const { performItemAnalysis } = require('./itemAnalysisService');
const { performErrorAnalysis } = require('./errorAnalysisService');
const { groupLearners } = require('./learnerGroupingService');
const { generateInterventionPlan } = require('./interventionPlanService');

/**
 * Fetches the most recently saved AI-generated intervention plan text for an
 * assessment, if one was saved when the data-driven assessment flow ran.
 *
 * @param {number} assessmentId
 * @returns {string|null}
 */
function getSavedAiInterventionText(assessmentId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT content FROM reports
    WHERE assessment_id = ? AND report_type = 'ai_intervention_plan'
    ORDER BY id DESC LIMIT 1
  `).get(assessmentId);
  return row ? row.content : null;
}

/**
 * Generates a comprehensive intervention report for an assessment by
 * combining item analysis, error analysis, and learner grouping — all
 * re-derived live from learner_results, so the report always reflects the
 * current state of the data even if it has been corrected since the
 * original WhatsApp conversation.
 *
 * @param {number} assessmentId - Assessment ID
 * @returns {Object} Comprehensive intervention report, or { error } if the
 *   assessment doesn't exist.
 */
function generateInterventionReport(assessmentId) {
  const db = getDb();

  const assessment = db.prepare(`
    SELECT * FROM assessments WHERE id = ?
  `).get(assessmentId);

  if (!assessment) {
    return { error: 'Assessment not found' };
  }

  const itemAnalysis = performItemAnalysis(assessmentId);
  const errorAnalysis = performErrorAnalysis(assessmentId, assessment.subject);
  const learnerGrouping = groupLearners(assessmentId);

  // Prefer the AI-generated plan already produced by the data-driven
  // assessment flow. Only fall back to the rules-based planner if nothing
  // was saved (e.g. report requested for an assessment analysed before this
  // persistence existed, or the AI step failed at the time).
  const savedAiPlan = getSavedAiInterventionText(assessmentId);
  let interventionPlan = null;
  if (savedAiPlan) {
    interventionPlan = { source: 'ai', text: savedAiPlan };
  } else if (!learnerGrouping.error) {
    const fallback = generateInterventionPlan(assessment.phone_hash, assessmentId);
    if (fallback && !fallback.error) {
      interventionPlan = { source: 'rules', ...fallback };
    }
  }

  return {
    assessmentId,
    assessment: {
      title: assessment.title,
      grade: assessment.grade,
      subject: assessment.subject,
      term: assessment.term,
      type: assessment.assessment_type,
      totalMarks: assessment.total_marks,
      phoneHash: assessment.phone_hash,
    },
    itemAnalysis,
    errorAnalysis,
    learnerGrouping,
    interventionPlan,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generates a teacher-friendly summary of the intervention report.
 *
 * @param {Object} report - Full intervention report
 * @returns {string} Teacher-friendly summary
 */
function generateTeacherSummary(report) {
  if (report.error) return `⚠️ ${report.error}`;

  let summary = `*Intervention Report: ${report.assessment.title}*\n\n`;
  summary += `Grade ${report.assessment.grade} ${report.assessment.subject} - Term ${report.assessment.term}\n\n`;

  const lg = report.learnerGrouping;
  if (lg && !lg.error) {
    summary += `*Class Performance Overview*\n`;
    summary += `Class Average: ${lg.classAverage}%\n`;
    summary += `Total Learners: ${lg.totalLearners}\n\n`;

    summary += `*Learner Distribution:*\n`;
    for (const group of Object.values(lg.groups)) {
      const percentage = lg.totalLearners > 0 ? Math.round((group.count / lg.totalLearners) * 100) : 0;
      summary += `${group.name}: ${group.count} learner${group.count !== 1 ? 's' : ''} (${percentage}%)\n`;
    }
    summary += `\n`;
  } else {
    summary += `_No learner results found for this assessment yet._\n\n`;
  }

  const ia = report.itemAnalysis;
  if (ia && !ia.error) {
    summary += `*Assessment Quality*\n`;
    summary += `Average Difficulty: ${Math.round(ia.averageFacilityValue * 100)}%\n`;
    summary += `Average Discrimination: ${ia.averageDiscrimination.toFixed(2)}\n`;
    const needsRevision = (ia.questions || []).filter(q => q.itemQuality === 'poor' || q.itemQuality === 'needs_revision').length;
    summary += `Questions Needing Revision: ${needsRevision}\n\n`;
  }

  const ea = report.errorAnalysis;
  if (ea && !ea.error && ea.errorPatterns && ea.errorPatterns.length > 0) {
    summary += `*Problem Areas Identified*\n`;
    const denom = (lg && !lg.error) ? lg.totalLearners : null;
    for (const error of ea.errorPatterns.slice(0, 3)) {
      const pctLabel = denom ? ` — ${Math.round((error.frequency / denom) * 100)}% of learners affected` : '';
      summary += `• ${error.topic}${pctLabel}\n`;
    }
    summary += `\n`;
  }

  if (report.interventionPlan) {
    if (report.interventionPlan.source === 'ai') {
      summary += `*Recommended Actions*\n${report.interventionPlan.text}\n\n`;
    } else if (report.interventionPlan.source === 'rules') {
      summary += `*Recommended Actions*\n`;
      summary += `• Focus intervention on: ${(report.interventionPlan.problemAreas || []).join(', ') || 'general revision'}\n`;
      summary += `• Target group size: ${(report.interventionPlan.targetGroups || []).reduce((s, g) => s + g.count, 0)} learners\n\n`;
    }
  }

  summary += `*Next Steps*\n`;
  summary += `1. Review detailed item analysis for question-level insights\n`;
  summary += `2. Address identified error patterns with targeted reteaching\n`;
  summary += `3. Implement differentiated activities for learner groups\n`;
  summary += `4. Monitor progress and adjust intervention as needed\n`;

  return summary;
}

/**
 * Generates an HOD-facing report: same underlying data as the teacher
 * summary, but framed for departmental submission — includes moderation-
 * relevant assessment-quality detail and a curriculum-alignment note.
 *
 * @param {Object} report - Full intervention report
 * @returns {string}
 */
function generateHodSummary(report) {
  if (report.error) return `⚠️ ${report.error}`;

  let summary = `*HOD REPORT*\n`;
  summary += `═══════════════════════════════\n`;
  summary += `*${report.assessment.title}*\n`;
  summary += `Grade ${report.assessment.grade} ${report.assessment.subject} | Term ${report.assessment.term}\n`;
  summary += `Total Marks: ${report.assessment.totalMarks}\n`;
  summary += `Generated: ${new Date(report.generatedAt).toLocaleDateString('en-ZA')}\n`;
  summary += `═══════════════════════════════\n\n`;

  const lg = report.learnerGrouping;
  if (lg && !lg.error) {
    summary += `*1. Learner Performance Summary*\n`;
    summary += `Total Learners Assessed: ${lg.totalLearners}\n`;
    summary += `Class Average: ${lg.classAverage}%\n`;
    summary += `Highest: ${lg.highestMark}% | Lowest: ${lg.lowestMark}%\n\n`;
    for (const group of Object.values(lg.groups)) {
      summary += `${group.name} (${group.range}): ${group.count} learner${group.count !== 1 ? 's' : ''}\n`;
    }
    summary += `\n`;
  } else {
    summary += `*1. Learner Performance Summary*\n_No learner results captured for this assessment._\n\n`;
  }

  const ia = report.itemAnalysis;
  if (ia && !ia.error) {
    summary += `*2. Assessment Quality (for moderation)*\n`;
    summary += `Average Facility Value: ${Math.round(ia.averageFacilityValue * 100)}%\n`;
    summary += `Average Discrimination Index: ${ia.averageDiscrimination.toFixed(2)}\n`;
    const weak = (ia.questions || []).filter(q => q.itemQuality === 'poor' || q.itemQuality === 'needs_revision');
    if (weak.length > 0) {
      summary += `Questions flagged for review: ${weak.map(q => `Q${q.questionNumber}`).join(', ')}\n`;
    }
    summary += `\n`;
  }

  const ea = report.errorAnalysis;
  if (ea && !ea.error && ea.errorPatterns && ea.errorPatterns.length > 0) {
    summary += `*3. Common Challenges*\n`;
    for (const error of ea.errorPatterns.slice(0, 5)) {
      summary += `• ${error.topic}\n`;
    }
    summary += `\n`;
  }

  summary += `*4. Interventions Implemented / Planned*\n`;
  if (report.interventionPlan && report.interventionPlan.source === 'ai') {
    summary += `${report.interventionPlan.text}\n\n`;
  } else if (report.interventionPlan && report.interventionPlan.source === 'rules') {
    summary += `• Target groups: ${(report.interventionPlan.targetGroups || []).map(g => `Group ${g.group} (${g.count})`).join(', ') || 'none identified'}\n`;
    summary += `• Problem areas: ${(report.interventionPlan.problemAreas || []).join(', ') || 'none identified'}\n\n`;
  } else {
    summary += `_No intervention plan generated yet for this assessment._\n\n`;
  }

  summary += `*5. Recommendation*\n`;
  summary += `Reviewed by: _________________________\n`;
  summary += `Date: _________________________\n`;
  summary += `HOD Comments: _________________________________________________\n`;
  summary += `Signature: _________________________\n`;

  return summary;
}

/**
 * Generates a parent-friendly report excerpt. If learnerName is given,
 * scopes to that learner's result; otherwise gives a general class overview.
 *
 * @param {Object} report - Full intervention report
 * @param {string|null} learnerName - Specific learner name (optional)
 * @returns {string} Parent-friendly summary
 */
function generateParentSummary(report, learnerName = null) {
  if (report.error) return `⚠️ ${report.error}`;

  let summary = `*Assessment Report: ${report.assessment.title}*\n\n`;
  summary += `Grade ${report.assessment.grade} ${report.assessment.subject}\n\n`;

  const lg = report.learnerGrouping;

  if (learnerName && lg && !lg.error) {
    let learnerGroupName = null;
    let learnerPercentage = null;

    for (const group of Object.values(lg.groups)) {
      const learner = group.learners.find(l => l.name.toLowerCase() === learnerName.toLowerCase());
      if (learner) {
        learnerGroupName = group.name;
        learnerPercentage = learner.percentage;
        break;
      }
    }

    if (learnerGroupName && learnerPercentage !== null) {
      summary += `*${learnerName}'s Performance*\n`;
      summary += `Achievement: ${learnerPercentage}%\n`;
      summary += `Group: ${learnerGroupName}\n\n`;

      if (learnerPercentage >= 80) {
        summary += `Your child is performing well. Continue encouraging them and provide extension opportunities.\n`;
      } else if (learnerPercentage >= 60) {
        summary += `Your child is achieving at expected levels. Consistent practice will help maintain progress.\n`;
      } else if (learnerPercentage >= 40) {
        summary += `Your child needs some additional support. Focus on the areas identified below.\n`;
      } else {
        summary += `Your child requires significant support. We are implementing targeted interventions to help.\n`;
      }
    } else {
      summary += `_${learnerName} was not found in this assessment's results._\n`;
    }
  } else if (lg && !lg.error) {
    summary += `*Class Overview*\n`;
    summary += `Class Average: ${lg.classAverage}%\n`;
    summary += `The class is ${lg.classAverage >= 60 ? 'performing well' : 'working towards improvement'}.\n`;
  } else {
    summary += `_No learner results are available for this assessment yet._\n`;
  }

  const ea = report.errorAnalysis;
  if (ea && !ea.error && ea.errorPatterns && ea.errorPatterns.length > 0) {
    summary += `\n*Areas of Focus*\n`;
    for (const error of ea.errorPatterns.slice(0, 2)) {
      summary += `• ${error.topic}\n`;
    }
  }

  summary += `\n*How You Can Help*\n`;
  summary += `• Review homework with your child\n`;
  summary += `• Encourage regular practice\n`;
  summary += `• Communicate any concerns with the teacher\n`;

  return summary;
}

/**
 * Generates an administrator summary across multiple assessments,
 * identifying trends and common problem areas.
 *
 * @param {Array<number>} assessmentIds - Array of assessment IDs
 * @returns {string} Administrator summary
 */
function generateAdministratorSummary(assessmentIds) {
  let summary = `*Administrator Intervention Report*\n\n`;
  summary += `Assessments Analyzed: ${assessmentIds.length}\n\n`;

  const allReports = [];
  for (const assessmentId of assessmentIds) {
    const report = generateInterventionReport(assessmentId);
    if (!report.error) {
      allReports.push(report);
    }
  }

  if (allReports.length === 0) {
    summary += `No valid assessment data available.\n`;
    return summary;
  }

  const reportsWithGrouping = allReports.filter(r => r.learnerGrouping && !r.learnerGrouping.error);
  const totalLearners = reportsWithGrouping.reduce((sum, r) => sum + r.learnerGrouping.totalLearners, 0);
  const averageClassAverage = reportsWithGrouping.length > 0
    ? reportsWithGrouping.reduce((sum, r) => sum + r.learnerGrouping.classAverage, 0) / reportsWithGrouping.length
    : null;

  summary += `*Overall Statistics*\n`;
  summary += `Total Learners Assessed: ${totalLearners}\n`;
  summary += averageClassAverage !== null
    ? `Average Class Performance: ${Math.round(averageClassAverage)}%\n\n`
    : `Average Class Performance: not available\n\n`;

  const problemAreaCounts = {};
  for (const report of allReports) {
    if (report.errorAnalysis && !report.errorAnalysis.error && report.errorAnalysis.errorPatterns) {
      for (const error of report.errorAnalysis.errorPatterns) {
        problemAreaCounts[error.topic] = (problemAreaCounts[error.topic] || 0) + 1;
      }
    }
  }

  const commonProblems = Object.entries(problemAreaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  summary += `*Common Problem Areas Across Classes*\n`;
  if (commonProblems.length > 0) {
    for (const [topic, count] of commonProblems) {
      summary += `• ${topic}: ${count} assessment(s)\n`;
    }
  } else {
    summary += `_No recurring problem areas identified._\n`;
  }
  summary += `\n`;

  const activeInterventions = allReports.filter(r => r.interventionPlan).length;
  summary += `*Intervention Status*\n`;
  summary += `Active Intervention Plans: ${activeInterventions}/${allReports.length}\n\n`;

  summary += `*Recommendations*\n`;
  if (commonProblems.length > 0) {
    summary += `• Consider professional development for: ${commonProblems[0][0]}\n`;
  }
  if (averageClassAverage !== null && averageClassAverage < 60) {
    summary += `• Monitor class performance closely\n`;
    summary += `• Provide additional teaching resources\n`;
  }
  summary += `• Review assessment quality and alignment\n`;

  return summary;
}

/**
 * Persists a generated report so it can be re-fetched without re-running
 * the analysis pipeline, and so REPORT/HOD/parent-report commands have a
 * record to query against.
 *
 * @param {string} phoneHash
 * @param {number} assessmentId
 * @param {'diagnostic'|'hod'|'parent'|'ai_intervention_plan'} reportType
 * @param {string} content
 * @param {string|null} learnerName
 */
function saveReport(phoneHash, assessmentId, reportType, content, learnerName = null) {
  const db = getDb();
  db.prepare(`
    INSERT INTO reports (phone_hash, assessment_id, report_type, learner_name, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(phoneHash, assessmentId, reportType, learnerName, content);
}

/**
 * Fetches the most recently saved report of a given type for an assessment.
 *
 * @param {number} assessmentId
 * @param {string} reportType
 * @param {string|null} learnerName
 * @returns {{ content: string, created_at: string }|null}
 */
function getSavedReport(assessmentId, reportType, learnerName = null) {
  const db = getDb();
  if (learnerName) {
    return db.prepare(`
      SELECT content, created_at FROM reports
      WHERE assessment_id = ? AND report_type = ? AND learner_name = ?
      ORDER BY id DESC LIMIT 1
    `).get(assessmentId, reportType, learnerName) || null;
  }
  return db.prepare(`
    SELECT content, created_at FROM reports
    WHERE assessment_id = ? AND report_type = ?
    ORDER BY id DESC LIMIT 1
  `).get(assessmentId, reportType) || null;
}

module.exports = {
  generateInterventionReport,
  generateTeacherSummary,
  generateHodSummary,
  generateParentSummary,
  generateAdministratorSummary,
  saveReport,
  getSavedReport,
  getSavedAiInterventionText,
};
