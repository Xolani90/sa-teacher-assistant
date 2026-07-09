'use strict';

/**
 * Curriculum Coverage Analysis Service
 * Tracks curriculum coverage, calculates progress, identifies gaps, and provides catch-up plans.
 * Aligned to CAPS and ATP requirements.
 *
 * Topic reference data is sourced from curriculumIntelligenceService's CAPS_TOPICS table,
 * which is the broader, better-maintained source covering more subjects and grades.
 * This avoids duplicating a narrow hardcoded table here.
 */

const { getDb } = require('../utils/database');
const { CAPS_TOPICS } = require('./curriculumIntelligenceService');

/**
 * Gets the expected topics for a given grade, subject, and term.
 *
 * @param {number} grade - Grade level
 * @param {string} subject - Subject name
 * @param {number} term - Term number (1-4)
 * @returns {Array} Array of topic names
 */
function getExpectedTopics(grade, subject, term) {
  // Normalise the same way curriculumIntelligenceService does — collapse whitespace
  // to underscores, strip anything that isn't a letter or underscore.
  const normalizedSubject = subject.toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z_]/g, '');
  const subjectTopics = CAPS_TOPICS[normalizedSubject];
  
  if (!subjectTopics) {
    return []; // Unknown subject - return empty
  }
  
  const gradeTopics = subjectTopics[grade];
  if (!gradeTopics) {
    return []; // Unknown grade - return empty
  }
  
  return gradeTopics[term] || [];
}

/**
 * Records that a topic has been covered.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {number} grade - Grade level
 * @param {string} subject - Subject name
 * @param {number} term - Term number
 * @param {string} topic - Topic name
 */
function markTopicCovered(phoneHash, grade, subject, term, topic) {
  const db = getDb();
  
  db.prepare(`
    INSERT INTO curriculum_coverage (phone_hash, grade, subject, term, topic, covered, date_covered)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(phone_hash, grade, subject, term, topic) 
    DO UPDATE SET covered = 1, date_covered = datetime('now'), updated_at = datetime('now')
  `).run(phoneHash, grade, subject, term, topic);
}

/**
 * Analyzes curriculum coverage for a teacher.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @param {number} grade - Grade level
 * @param {string} subject - Subject name
 * @param {number} term - Term number (optional, analyzes all terms if not provided)
 * @returns {Object} Coverage analysis results
 */
function analyzeCoverage(phoneHash, grade, subject, term = null) {
  const db = getDb();
  
  const termsToAnalyze = term ? [term] : [1, 2, 3, 4];
  const results = [];
  
  for (const currentTerm of termsToAnalyze) {
    const expectedTopics = getExpectedTopics(grade, subject, currentTerm);
    
    if (expectedTopics.length === 0) {
      continue; // Skip if no topics defined for this term
    }
    
    const coveredTopics = db.prepare(`
      SELECT topic, date_covered FROM curriculum_coverage
      WHERE phone_hash = ? AND grade = ? AND subject = ? AND term = ? AND covered = 1
    `).all(phoneHash, grade, subject, currentTerm);
    
    const coveredTopicNames = new Set(coveredTopics.map(t => t.topic));
    const outstandingTopics = expectedTopics.filter(t => !coveredTopicNames.has(t));
    
    const coveragePercentage = (coveredTopicNames.size / expectedTopics.length) * 100;
    
    results.push({
      term: currentTerm,
      expectedTopics: expectedTopics.length,
      coveredTopics: coveredTopicNames.size,
      outstandingTopics: outstandingTopics.length,
      coveragePercentage: Math.round(coveragePercentage),
      outstandingTopicList: outstandingTopics,
      coveredTopicList: Array.from(coveredTopicNames),
    });
  }
  
  // Calculate overall coverage
  const totalExpected = results.reduce((sum, r) => sum + r.expectedTopics, 0);
  const totalCovered = results.reduce((sum, r) => sum + r.coveredTopics, 0);
  const overallCoverage = totalExpected > 0 ? Math.round((totalCovered / totalExpected) * 100) : 0;
  
  return {
    phoneHash,
    grade,
    subject,
    term,
    overallCoverage,
    totalExpected,
    totalCovered,
    // Explicit signal: false means we have no CAPS topic reference data for this
    // subject/grade combination, so callers should say "not available" rather than
    // showing a misleading "0% — significantly behind" message.
    dataAvailable: totalExpected > 0,
    termResults: results,
    summary: generateCoverageSummary(results, overallCoverage),
    catchUpPlan: generateCatchUpPlan(results),
  };
}

/**
 * Generates a human-readable summary of curriculum coverage.
 *
 * @param {Array} termResults - Array of term results
 * @param {number} overallCoverage - Overall coverage percentage
 * @returns {string} Summary text
 */
function generateCoverageSummary(termResults, overallCoverage) {
  let summary = `*Curriculum Coverage Summary*\n\n`;
  summary += `Overall Progress: ${overallCoverage}%\n\n`;
  
  for (const result of termResults) {
    const status = result.coveragePercentage === 100 ? '✅ Complete' : 
                   result.coveragePercentage >= 75 ? '🟡 On Track' :
                   result.coveragePercentage >= 50 ? '🟠 Behind' : '🔴 Significantly Behind';
    
    summary += `*Term ${result.term}:* ${result.coveragePercentage}% ${status}\n`;
    summary += `  Covered: ${result.coveredTopics}/${result.expectedTopics} topics\n`;
    
    if (result.outstandingTopics > 0) {
      summary += `  Outstanding: ${result.outstandingTopics} topic(s)\n`;
    }
    summary += `\n`;
  }
  
  return summary;
}

/**
 * Generates a catch-up plan for outstanding topics.
 *
 * @param {Array} termResults - Array of term results
 * @returns {string} Catch-up plan text
 */
function generateCatchUpPlan(termResults) {
  const termsWithGaps = termResults.filter(r => r.outstandingTopics > 0);
  
  if (termsWithGaps.length === 0) {
    return '✅ All topics are on track. No catch-up needed.';
  }
  
  let plan = `*Catch-Up Plan*\n\n`;
  plan += `The following terms have outstanding topics:\n\n`;
  
  for (const result of termsWithGaps) {
    plan += `**Term ${result.term}**\n`;
    plan += `Outstanding Topics (${result.outstandingTopics}):\n`;
    
    for (const topic of result.outstandingTopicList.slice(0, 5)) { // Show max 5
      plan += `• ${topic}\n`;
    }
    
    if (result.outstandingTopicList.length > 5) {
      plan += `• ... and ${result.outstandingTopicList.length - 5} more\n`;
    }
    
    plan += `\n`;
  }
  
  plan += `*Recommendations:*\n`;
  plan += `• Prioritize essential topics from earlier terms\n`;
  plan += `• Integrate outstanding topics into current lessons where possible\n`;
  plan += `• Consider dedicated catch-up sessions for critical gaps\n`;
  plan += `• Use holiday periods or after-school time for remediation\n`;
  
  return plan;
}

/**
 * Updates curriculum coverage based on assessment data.
 * When an assessment is created, mark the ATP topics it covers as taught.
 *
 * @param {number} assessmentId - Assessment ID
 */
function updateCoverageFromAssessment(assessmentId) {
  const db = getDb();
  
  const assessment = db.prepare(`
    SELECT phone_hash, grade, subject, term, atp_topics FROM assessments WHERE id = ?
  `).get(assessmentId);
  
  if (!assessment || !assessment.atp_topics) {
    return;
  }
  
  try {
    const topics = JSON.parse(assessment.atp_topics);
    for (const topic of topics) {
      markTopicCovered(
        assessment.phone_hash,
        assessment.grade,
        assessment.subject,
        assessment.term,
        topic
      );
    }
  } catch (e) {
    console.error('Failed to parse ATP topics:', e.message);
  }
}

/**
 * Gets a progress report for a teacher across all their subjects.
 *
 * @param {string} phoneHash - Teacher's phone hash
 * @returns {Array} Array of coverage results per subject
 */
function getTeacherProgressReport(phoneHash) {
  const db = getDb();
  
  const teacher = db.prepare(`
    SELECT grade, subject FROM teachers WHERE phone_hash = ?
  `).get(phoneHash);
  
  if (!teacher || !teacher.grade || !teacher.subject) {
    return { error: 'Teacher profile incomplete. Please set grade and subject.' };
  }
  
  const grade = parseInt(teacher.grade);
  const subject = teacher.subject;
  
  return analyzeCoverage(phoneHash, grade, subject);
}

module.exports = {
  markTopicCovered,
  analyzeCoverage,
  generateCoverageSummary,
  generateCatchUpPlan,
  updateCoverageFromAssessment,
  getTeacherProgressReport,
  getExpectedTopics,
};
