'use strict';

/**
 * @deprecated DO NOT WIRE INTO PRODUCTION
 *
 * This service generates static template-based reteaching plans using fixed
 * phase bullet points with topic-string substitution only. It is entirely
 * superseded by the post-assessment full intervention plan flow in webhook.js
 * (~line 1118–1145), which calls generateContent() with fullInterventionPlan
 * to produce AI-generated, assessment-aware reteaching plans using real
 * learner group data and question-level error analysis.
 *
 * generateConceptualReteaching("Fractions") and
 * generateConceptualReteaching("Oxidation") produce identical output
 * except for the topic name substitution — no CAPS alignment, no subject
 * context, no connection to error patterns.
 *
 * Retain until a cleanup pass confirms there are no remaining references.
 * See Phase B audit report for full evidence.
 */

/**
 * Reteaching Planner Service
 * Creates structured reteaching plans based on error analysis and learner needs.
 * Provides step-by-step guidance for reteaching specific topics.
 */

/**
 * Generates a reteaching plan for a specific topic based on error analysis.
 *
 * @param {string} topic - The topic to reteach
 * @param {string} errorType - Type of error (conceptual, procedural, misconception, language, knowledge_gap)
 * @param {string} subject - Subject context
 * @param {number} durationMinutes - Duration of reteaching session
 * @returns {Object} Reteaching plan
 */
function generateReteachingPlan(topic, errorType, subject = 'general', durationMinutes = 45) {
  const plan = {
    topic,
    errorType,
    subject,
    durationMinutes,
    phases: [],
    materials: [],
    assessment: '',
  };

  // Determine reteaching approach based on error type
  switch (errorType) {
    case 'conceptual':
      plan.phases = generateConceptualReteaching(topic, durationMinutes);
      plan.materials = ['Concrete materials', 'Visual aids', 'Real-world examples', 'Graphic organizers'];
      break;
    case 'procedural':
      plan.phases = generateProceduralReteaching(topic, durationMinutes);
      plan.materials = ['Worked examples', 'Step-by-step worksheets', 'Practice problems', 'Answer keys'];
      break;
    case 'misconception':
      plan.phases = generateMisconceptionReteaching(topic, durationMinutes);
      plan.materials = ['Counter-examples', 'Discussion prompts', 'Misconception cards', 'Evidence materials'];
      break;
    case 'language':
      plan.phases = generateLanguageSupportReteaching(topic, durationMinutes);
      plan.materials = ['Vocabulary lists', 'Visual glossary', 'Sentence frames', 'Bilingual support if needed'];
      break;
    case 'knowledge_gap':
      plan.phases = generateKnowledgeGapReteaching(topic, durationMinutes);
      plan.materials = ['Prerequisite checklists', 'Remediation materials', 'Foundational worksheets', 'Diagnostic tools'];
      break;
    default:
      plan.phases = generateGeneralReteaching(topic, durationMinutes);
      plan.materials = ['General teaching materials', 'Practice activities', 'Assessment tools'];
  }

  plan.assessment = generateReteachingAssessment(topic, errorType);

  return plan;
}

/**
 * Generates phases for conceptual reteaching.
 */
function generateConceptualReteaching(topic, duration) {
  const introTime = Math.round(duration * 0.15);
  const buildTime = Math.round(duration * 0.35);
  const practiceTime = Math.round(duration * 0.35);
  const assessTime = Math.round(duration * 0.15);

  return [
    {
      phase: 'Introduction',
      duration: `${introTime} minutes`,
      activities: [
        `Connect ${topic} to prior knowledge and real-world experiences`,
        'Use a concrete example or demonstration',
        'Activate learners\' existing understanding through questioning',
      ],
    },
    {
      phase: 'Concept Building',
      duration: `${buildTime} minutes`,
      activities: [
        `Teach ${topic} using concrete-to-abstract progression`,
        'Use multiple representations (visual, verbal, symbolic)',
        'Provide clear explanations with examples',
        'Check for understanding frequently',
      ],
    },
    {
      phase: 'Guided Practice',
      duration: `${practiceTime} minutes`,
      activities: [
        'Work through examples together with learner input',
        'Provide scaffolding and support as needed',
        'Use think-aloud strategies to model thinking',
        'Gradually release responsibility to learners',
      ],
    },
    {
      phase: 'Assessment',
      duration: `${assessTime} minutes`,
      activities: [
        'Quick check for understanding',
        'Exit ticket or short assessment',
        'Identify learners who need additional support',
      ],
    },
  ];
}

/**
 * Generates phases for procedural reteaching.
 */
function generateProceduralReteaching(topic, duration) {
  const introTime = Math.round(duration * 0.1);
  const modelTime = Math.round(duration * 0.3);
  const guidedTime = Math.round(duration * 0.35);
  const practiceTime = Math.round(duration * 0.25);

  return [
    {
      phase: 'Introduction',
      duration: `${introTime} minutes`,
      activities: [
        `Review the purpose and context of ${topic}`,
        'Explain why this procedure is important',
        'Activate prior procedural knowledge',
      ],
    },
    {
      phase: 'Modeling',
      duration: `${modelTime} minutes`,
      activities: [
        `Demonstrate the procedure for ${topic} step-by-step`,
        'Use worked examples with clear annotations',
        'Think aloud to explain each step',
        'Highlight common pitfalls to avoid',
      ],
    },
    {
      phase: 'Guided Practice',
      duration: `${guidedTime} minutes`,
      activities: [
        'Practice together with immediate feedback',
        'Use partially completed examples',
        'Provide prompts and cues as needed',
        'Correct errors immediately and explain',
      ],
    },
    {
      phase: 'Independent Practice',
      duration: `${practiceTime} minutes`,
      activities: [
        'Learners practice independently',
        'Monitor and provide targeted support',
        'Address misconceptions as they arise',
        'Celebrate correct procedures',
      ],
    },
  ];
}

/**
 * Generates phases for misconception reteaching.
 */
function generateMisconceptionReteaching(topic, duration) {
  const introTime = Math.round(duration * 0.15);
  const confrontTime = Math.round(duration * 0.3);
  const rebuildTime = Math.round(duration * 0.35);
  const assessTime = Math.round(duration * 0.2);

  return [
    {
      phase: 'Introduction',
      duration: `${introTime} minutes`,
      activities: [
        `Present a scenario related to ${topic}`,
        'Ask learners to predict or explain',
        'Reveal the common misconception',
        'Validate that this is a common misunderstanding',
      ],
    },
    {
      phase: 'Confront Misconception',
      duration: `${confrontTime} minutes`,
      activities: [
        'Present counter-examples that challenge the misconception',
        'Use evidence and reasoning to show why the misconception is incorrect',
        'Encourage discussion and debate',
        'Guide learners to discover the correct understanding',
      ],
    },
    {
      phase: 'Rebuild Understanding',
      duration: `${rebuildTime} minutes`,
      activities: [
        `Teach the correct concept for ${topic} clearly`,
        'Provide multiple examples and non-examples',
        'Use analogies and visual representations',
        'Connect to related concepts',
      ],
    },
    {
      phase: 'Assessment',
      duration: `${assessTime} minutes`,
      activities: [
        'Assess understanding of the correct concept',
        'Check that the misconception has been addressed',
        'Provide opportunities to apply the correct understanding',
      ],
    },
  ];
}

/**
 * Generates phases for language support reteaching.
 */
function generateLanguageSupportReteaching(topic, duration) {
  const vocabTime = Math.round(duration * 0.2);
  const teachTime = Math.round(duration * 0.3);
  const practiceTime = Math.round(duration * 0.35);
  const assessTime = Math.round(duration * 0.15);

  return [
    {
      phase: 'Vocabulary Development',
      duration: `${vocabTime} minutes`,
      activities: [
        `Introduce key vocabulary for ${topic}`,
        'Provide definitions and examples',
        'Use visual supports for each term',
        'Create a word wall or vocabulary chart',
      ],
    },
    {
      phase: 'Simplified Instruction',
      duration: `${teachTime} minutes`,
      activities: [
        `Teach ${topic} using simplified language`,
        'Use shorter sentences and clear instructions',
        'Provide sentence frames for responses',
        'Check for understanding frequently',
      ],
    },
    {
      phase: 'Supported Practice',
      duration: `${practiceTime} minutes`,
      activities: [
        'Practice with language support',
        'Use visual aids and graphic organizers',
        'Provide bilingual support if available',
        'Encourage use of new vocabulary',
      ],
    },
    {
      phase: 'Assessment',
      duration: `${assessTime} minutes`,
      activities: [
        'Assess understanding with language accommodations',
        'Allow multiple ways to demonstrate understanding',
        'Check vocabulary usage',
      ],
    },
  ];
}

/**
 * Generates phases for knowledge gap reteaching.
 */
function generateKnowledgeGapReteaching(topic, duration) {
  const diagnoseTime = Math.round(duration * 0.15);
  const remediateTime = Math.round(duration * 0.4);
  const connectTime = Math.round(duration * 0.3);
  const assessTime = Math.round(duration * 0.15);

  return [
    {
      phase: 'Diagnose Gap',
      duration: `${diagnoseTime} minutes`,
      activities: [
        'Identify specific prerequisite knowledge missing',
        'Use quick diagnostic questions',
        'Determine the starting point for reteaching',
      ],
    },
    {
      phase: 'Remediation',
      duration: `${remediateTime} minutes`,
      activities: [
        'Teach missing foundational concepts',
        'Use concrete examples and hands-on activities',
        'Build understanding step-by-step',
        'Provide ample practice at foundational level',
      ],
    },
    {
      phase: 'Connect to Current Topic',
      duration: `${connectTime} minutes`,
      activities: [
        `Connect foundational knowledge to ${topic}`,
        'Show how prerequisite skills apply',
        'Bridge the gap with scaffolded activities',
        'Build confidence before moving to current material',
      ],
    },
    {
      phase: 'Assessment',
      duration: `${assessTime} minutes`,
      activities: [
        'Check understanding of prerequisite knowledge',
        'Assess readiness for current topic',
        'Plan next steps based on results',
      ],
    },
  ];
}

/**
 * Generates phases for general reteaching.
 */
function generateGeneralReteaching(topic, duration) {
  const introTime = Math.round(duration * 0.15);
  const teachTime = Math.round(duration * 0.35);
  const practiceTime = Math.round(duration * 0.35);
  const assessTime = Math.round(duration * 0.15);

  return [
    {
      phase: 'Introduction',
      duration: `${introTime} minutes`,
      activities: [
        `Review ${topic} and identify areas of difficulty`,
        'Set clear learning goals',
        'Activate prior knowledge',
      ],
    },
    {
      phase: 'Reteaching',
      duration: `${teachTime} minutes`,
      activities: [
        `Teach ${topic} using alternative approach`,
        'Use different examples and explanations',
        'Address specific difficulties identified',
        'Provide multiple representations',
      ],
    },
    {
      phase: 'Practice',
      duration: `${practiceTime} minutes`,
      activities: [
        'Guided practice with support',
        'Independent practice',
        'Immediate feedback and correction',
      ],
    },
    {
      phase: 'Assessment',
      duration: `${assessTime} minutes`,
      activities: [
        'Check for understanding',
        'Identify remaining gaps',
        'Plan further support if needed',
      ],
    },
  ];
}

/**
 * Generates assessment suggestions for reteaching.
 *
 * @param {string} topic - Topic being retaught
 * @param {string} errorType - Type of error
 * @returns {string} Assessment suggestions
 */
function generateReteachingAssessment(topic, errorType) {
  let assessment = `*Assessment for ${topic} Reteaching*\n\n`;

  switch (errorType) {
    case 'conceptual':
      assessment += `• Use concept maps or graphic organizers to check understanding\n`;
      assessment += `• Ask learners to explain concepts in their own words\n`;
      assessment += `• Provide real-world scenarios for application\n`;
      break;
    case 'procedural':
      assessment += `• Observe learners performing the procedure\n`;
      assessment += `• Use step-by-step problem solving\n`;
      assessment += `• Check for common procedural errors\n`;
      break;
    case 'misconception':
      assessment += `• Ask learners to explain why the misconception is incorrect\n`;
      assessment += `• Provide scenarios where the misconception would lead to errors\n`;
      assessment += `• Check that correct understanding is applied\n`;
      break;
    case 'language':
      assessment += `• Allow multiple response modes (oral, written, visual)\n`;
      assessment += `• Check vocabulary usage\n`;
      assessment += `• Use simplified language in assessment\n`;
      break;
    case 'knowledge_gap':
      assessment += `• Check prerequisite knowledge\n`;
      assessment += `• Assess readiness for current topic\n`;
      assessment += `• Identify remaining gaps\n`;
      break;
    default:
      assessment += `• Quick check for understanding\n`;
      assessment += `• Exit ticket\n`;
      assessment += `• Observation of practice\n`;
  }

  return assessment;
}

/**
 * Generates a summary of the reteaching plan.
 *
 * @param {Object} plan - Reteaching plan
 * @returns {string} Summary text
 */
function generateReteachingSummary(plan) {
  let summary = `*Reteaching Plan: ${plan.topic}*\n\n`;
  summary += `Error Type: ${plan.errorType}\n`;
  summary += `Duration: ${plan.durationMinutes} minutes\n\n`;
  summary += `*Materials Needed:*\n`;
  for (const material of plan.materials) {
    summary += `• ${material}\n`;
  }
  summary += `\n*Lesson Phases:*\n`;

  for (const phase of plan.phases) {
    summary += `\n**${phase.phase}** (${phase.duration})\n`;
    for (const activity of phase.activities) {
      summary += `• ${activity}\n`;
    }
  }

  summary += `\n${plan.assessment}`;

  return summary;
}

module.exports = {
  generateReteachingPlan,
  generateReteachingSummary,
};
