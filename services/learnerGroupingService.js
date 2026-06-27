'use strict';

/**
 * Learner Grouping Engine
 * Groups learners based on assessment performance using configurable thresholds.
 * Supports default grouping (A, B, C, D) and custom grouping strategies.
 */

const { getDb } = require('../utils/database');

/**
 * Default grouping thresholds
 */
const DEFAULT_THRESHOLDS = {
  groupA: 80, // 80-100% - High achievers
  groupB: 60, // 60-79% - Achieving
  groupC: 40, // 40-59% - Needs support
  groupD: 0,  // 0-39% - Significant intervention needed
};

/**
 * Groups learners based on assessment results.
 *
 * @param {number} assessmentId - Assessment ID
 * @param {Object} customThresholds - Optional custom thresholds
 * @returns {Object} Grouping results
 */
function groupLearners(assessmentId, customThresholds = null) {
  const db = getDb();

  // Get all learner results for this assessment
  const learnerResults = db.prepare(`
    SELECT * FROM learner_results WHERE assessment_id = ?
  `).all(assessmentId);

  if (learnerResults.length === 0) {
    return { error: 'No learner results found for this assessment' };
  }

  const thresholds = customThresholds || DEFAULT_THRESHOLDS;

  // Group learners
  const groups = {
    A: { name: 'Group A', range: `${thresholds.groupA}-100%`, learners: [], count: 0 },
    B: { name: 'Group B', range: `${thresholds.groupB}-${thresholds.groupA - 1}%`, learners: [], count: 0 },
    C: { name: 'Group C', range: `${thresholds.groupC}-${thresholds.groupB - 1}%`, learners: [], count: 0 },
    D: { name: 'Group D', range: `0-${thresholds.groupC - 1}%`, learners: [], count: 0 },
  };

  for (const learner of learnerResults) {
    const percentage = learner.percentage;
    let group;

    if (percentage >= thresholds.groupA) {
      group = 'A';
    } else if (percentage >= thresholds.groupB) {
      group = 'B';
    } else if (percentage >= thresholds.groupC) {
      group = 'C';
    } else {
      group = 'D';
    }

    groups[group].learners.push({
      name: learner.learner_name,
      percentage: Math.round(percentage),
      mark: learner.mark,
      totalMarks: learner.total_marks,
    });
    groups[group].count++;
  }

  // Calculate statistics
  const totalLearners = learnerResults.length;
  const classAverage = learnerResults.reduce((sum, l) => sum + l.percentage, 0) / totalLearners;
  const highestMark = Math.max(...learnerResults.map(l => l.percentage));
  const lowestMark = Math.min(...learnerResults.map(l => l.percentage));

  return {
    assessmentId,
    thresholds,
    totalLearners,
    classAverage: Math.round(classAverage),
    highestMark: Math.round(highestMark),
    lowestMark: Math.round(lowestMark),
    groups,
    summary: generateGroupingSummary(groups, totalLearners, classAverage),
    recommendations: generateGroupingRecommendations(groups, totalLearners),
  };
}

/**
 * Generates a summary of learner grouping.
 *
 * @param {Object} groups - Group data
 * @param {number} totalLearners - Total number of learners
 * @param {number} classAverage - Class average percentage
 * @returns {string} Summary text
 */
function generateGroupingSummary(groups, totalLearners, classAverage) {
  let summary = `*Learner Grouping Summary*\n\n`;
  summary += `Total Learners: ${totalLearners}\n`;
  summary += `Class Average: ${Math.round(classAverage)}%\n\n`;

  for (const [key, group] of Object.entries(groups)) {
    const percentage = Math.round((group.count / totalLearners) * 100);
    summary += `**${group.name}** (${group.range})\n`;
    summary += `Learners: ${group.count} (${percentage}%)\n`;
    
    if (group.count > 0) {
      const avg = group.learners.reduce((sum, l) => sum + l.percentage, 0) / group.count;
      summary += `Average: ${Math.round(avg)}%\n`;
    }
    summary += `\n`;
  }

  return summary;
}

/**
 * Generates recommendations based on grouping.
 *
 * @param {Object} groups - Group data
 * @returns {string} Recommendations text
 */
function generateGroupingRecommendations(groups, totalLearners) {
  let recommendations = `*Grouping Recommendations*\n\n`;

  // Group A recommendations
  if (groups.A.count > 0) {
    recommendations += `**Group A (High Achievers)**\n`;
    recommendations += `• Provide extension activities and enrichment tasks\n`;
    recommendations += `• Consider peer tutoring opportunities\n`;
    recommendations += `• Challenge with higher-order thinking questions\n`;
    recommendations += `• Prepare for advanced work or competitions\n\n`;
  }

  // Group B recommendations
  if (groups.B.count > 0) {
    recommendations += `**Group B (Achieving)**\n`;
    recommendations += `• Consolidate current understanding\n`;
    recommendations += `• Provide moderate challenge activities\n`;
    recommendations += `• Focus on application and analysis skills\n`;
    recommendations += `• Monitor for potential movement to Group A or C\n\n`;
  }

  // Group C recommendations
  if (groups.C.count > 0) {
    recommendations += `**Group C (Needs Support)**\n`;
    recommendations += `• Provide targeted remediation\n`;
    recommendations += `• Use scaffolded learning activities\n`;
    recommendations += `• Focus on foundational concepts\n`;
    recommendations += `• Regular check-ins and feedback\n\n`;
  }

  // Group D recommendations
  if (groups.D.count > 0) {
    recommendations += `**Group D (Significant Intervention Needed)**\n`;
    recommendations += `• Intensive intervention required\n`;
    recommendations += `• One-on-one or small group support\n`;
    recommendations += `• Re-teach fundamental concepts\n`;
    recommendations += `• Consider additional support resources\n`;
    recommendations += `• Involve parents/guardians if appropriate\n\n`;
  }

  // Overall recommendations
  const classPerformance = groups.A.count + groups.B.count > totalLearners * 0.6 ? 'good' :
                          groups.A.count + groups.B.count > totalLearners * 0.4 ? 'moderate' : 'needs attention';

  recommendations += `*Overall Class Performance: ${classPerformance.toUpperCase()}*\n`;
  
  if (classPerformance === 'needs attention') {
    recommendations += `Consider reviewing teaching strategies, assessment alignment, and pacing.\n`;
  }

  return recommendations;
}

/**
 * Creates custom grouping thresholds.
 *
 * @param {number} groupA - Minimum percentage for Group A
 * @param {number} groupB - Minimum percentage for Group B
 * @param {number} groupC - Minimum percentage for Group C
 * @returns {Object} Custom thresholds
 */
function createCustomThresholds(groupA, groupB, groupC) {
  return {
    groupA: Math.min(100, Math.max(0, groupA)),
    groupB: Math.min(groupA - 1, Math.max(0, groupB)),
    groupC: Math.min(groupB - 1, Math.max(0, groupC)),
    groupD: 0,
  };
}

/**
 * Groups learners across multiple assessments for trend analysis.
 *
 * @param {Array} assessmentIds - Array of assessment IDs
 * @returns {Object} Multi-assessment grouping results
 */
function groupLearnersAcrossAssessments(assessmentIds) {
  const db = getDb();

  const allResults = [];
  for (const assessmentId of assessmentIds) {
    const results = db.prepare(`
      SELECT * FROM learner_results WHERE assessment_id = ?
    `).all(assessmentId);
    allResults.push(...results);
  }

  if (allResults.length === 0) {
    return { error: 'No learner results found for these assessments' };
  }

  // Calculate average performance per learner across all assessments
  const learnerAverages = {};
  for (const result of allResults) {
    if (!learnerAverages[result.learner_name]) {
      learnerAverages[result.learner_name] = {
        name: result.learner_name,
        totalPercentage: 0,
        assessmentCount: 0,
      };
    }
    learnerAverages[result.learner_name].totalPercentage += result.percentage;
    learnerAverages[result.learner_name].assessmentCount++;
  }

  const learnerData = Object.values(learnerAverages).map(l => ({
    name: l.name,
    averagePercentage: l.totalPercentage / l.assessmentCount,
  }));

  // Group based on average performance
  const groups = {
    A: { name: 'Group A', range: '80-100%', learners: [], count: 0 },
    B: { name: 'Group B', range: '60-79%', learners: [], count: 0 },
    C: { name: 'Group C', range: '40-59%', learners: [], count: 0 },
    D: { name: 'Group D', range: '0-39%', learners: [], count: 0 },
  };

  for (const learner of learnerData) {
    const percentage = learner.averagePercentage;
    let group;

    if (percentage >= 80) group = 'A';
    else if (percentage >= 60) group = 'B';
    else if (percentage >= 40) group = 'C';
    else group = 'D';

    groups[group].learners.push({
      name: learner.name,
      averagePercentage: Math.round(percentage),
    });
    groups[group].count++;
  }

  return {
    assessmentIds,
    totalLearners: learnerData.length,
    groups,
    summary: generateGroupingSummary(groups, learnerData.length, 
      learnerData.reduce((sum, l) => sum + l.averagePercentage, 0) / learnerData.length),
  };
}

/**
 * Identifies learners who have moved between groups across assessments.
 *
 * @param {number} firstAssessmentId - First assessment ID
 * @param {number} secondAssessmentId - Second assessment ID
 * @returns {Object} Movement analysis
 */
function analyzeGroupMovement(firstAssessmentId, secondAssessmentId) {
  const firstGrouping = groupLearners(firstAssessmentId);
  const secondGrouping = groupLearners(secondAssessmentId);

  if (firstGrouping.error || secondGrouping.error) {
    return { error: 'Could not analyze group movement' };
  }

  const movements = {
    improved: [],
    declined: [],
    stable: [],
  };

  // Create lookup maps
  const firstGroups = {};
  for (const [key, group] of Object.entries(firstGrouping.groups)) {
    for (const learner of group.learners) {
      firstGroups[learner.name] = key;
    }
  }

  const secondGroups = {};
  for (const [key, group] of Object.entries(secondGrouping.groups)) {
    for (const learner of group.learners) {
      secondGroups[learner.name] = key;
    }
  }

  // Analyze movements
  const allLearners = new Set([...Object.keys(firstGroups), ...Object.keys(secondGroups)]);
  
  for (const learnerName of allLearners) {
    const firstGroup = firstGroups[learnerName];
    const secondGroup = secondGroups[learnerName];

    if (!firstGroup || !secondGroup) continue; // Learner not in both assessments

    if (secondGroup < firstGroup) {
      movements.improved.push({ name: learnerName, from: firstGroup, to: secondGroup });
    } else if (secondGroup > firstGroup) {
      movements.declined.push({ name: learnerName, from: firstGroup, to: secondGroup });
    } else {
      movements.stable.push({ name: learnerName, group: firstGroup });
    }
  }

  return {
    firstAssessmentId,
    secondAssessmentId,
    movements,
    summary: generateMovementSummary(movements),
  };
}

/**
 * Generates a summary of group movements.
 *
 * @param {Object} movements - Movement data
 * @returns {string} Summary text
 */
function generateMovementSummary(movements) {
  let summary = `*Group Movement Analysis*\n\n`;
  summary += `Improved: ${movements.improved.length} learners\n`;
  summary += `Declined: ${movements.declined.length} learners\n`;
  summary += `Stable: ${movements.stable.length} learners\n\n`;

  if (movements.improved.length > 0) {
    summary += `**Improved Learners:**\n`;
    for (const learner of movements.improved.slice(0, 5)) {
      summary += `• ${learner.name}: Group ${learner.from} → Group ${learner.to}\n`;
    }
    if (movements.improved.length > 5) {
      summary += `• ... and ${movements.improved.length - 5} more\n`;
    }
    summary += `\n`;
  }

  if (movements.declined.length > 0) {
    summary += `**Declined Learners:**\n`;
    for (const learner of movements.declined.slice(0, 5)) {
      summary += `• ${learner.name}: Group ${learner.from} → Group ${learner.to}\n`;
    }
    if (movements.declined.length > 5) {
      summary += `• ... and ${movements.declined.length - 5} more\n`;
    }
    summary += `\n`;
  }

  return summary;
}

module.exports = {
  groupLearners,
  createCustomThresholds,
  groupLearnersAcrossAssessments,
  analyzeGroupMovement,
  DEFAULT_THRESHOLDS,
};
