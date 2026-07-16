'use strict';

/**
 * @deprecated DO NOT WIRE INTO PRODUCTION
 *
 * This service generates static template-based differentiated activities by
 * simple topic-string interpolation. It is entirely superseded by two better
 * paths that are already live:
 *
 *   1. EASIER / HARDER / VISUAL / ORAL commands in webhook.js (lines ~2736–2790)
 *      → re-run processGeneration() with a differentiation flag, feeding into
 *      the AI-powered worksheetPrompt() which has proper, subject-aware
 *      differentiation instructions.
 *
 *   2. The post-assessment full intervention plan flow (webhook.js ~line 1118–1145)
 *      → calls generateContent() with fullInterventionPlan, producing AI-generated,
 *      assessment-aware differentiated activities that use actual learner group data.
 *
 * Wiring this service would produce visibly weaker output than either path above.
 * Retain until a cleanup pass confirms there are no remaining references.
 * See Phase B audit report for full evidence.
 */

/**
 * Differentiated Intervention Activities Service
 * Generates tailored activities for different learner groups based on their needs.
 * Supports easier, harder, visual, oral, and other differentiation strategies.
 */

/**
 * Generates differentiated activities for a specific topic and learner group.
 *
 * @param {string} topic - The topic to create activities for
 * @param {string} learnerGroup - The target learner group (A, B, C, D)
 * @param {string} subject - Subject context
 * @param {string} differentiationType - Type of differentiation (easier, harder, visual, oral)
 * @returns {Object} Differentiated activities
 */
function generateDifferentiatedActivities(topic, learnerGroup, subject = 'general', differentiationType = 'standard') {
  const activities = {
    topic,
    learnerGroup,
    differentiationType,
    activities: [],
    instructions: '',
  };

  // Generate activities based on learner group and differentiation type
  switch (learnerGroup) {
    case 'A':
      activities.activities = generateGroupAActivities(topic, subject, differentiationType);
      activities.instructions = 'These activities are designed to challenge high achievers with extension tasks and higher-order thinking.';
      break;
    case 'B':
      activities.activities = generateGroupBActivities(topic, subject, differentiationType);
      activities.instructions = 'These activities consolidate understanding and provide moderate challenge.';
      break;
    case 'C':
      activities.activities = generateGroupCActivities(topic, subject, differentiationType);
      activities.instructions = 'These activities provide scaffolded support and focus on foundational concepts.';
      break;
    case 'D':
      activities.activities = generateGroupDActivities(topic, subject, differentiationType);
      activities.instructions = 'These activities provide intensive support with step-by-step guidance and concrete examples.';
      break;
    default:
      activities.activities = generateStandardActivities(topic, subject, differentiationType);
      activities.instructions = 'These activities are suitable for mixed-ability groups.';
  }

  return activities;
}

/**
 * Generates activities for Group A (high achievers).
 */
function generateGroupAActivities(topic, subject, differentiationType) {
  const baseActivities = [
    {
      name: 'Extension Task',
      description: `Apply ${topic} concepts to a complex, real-world scenario requiring synthesis and evaluation.`,
      duration: '20-30 minutes',
      materials: 'Problem scenario, research materials',
    },
    {
      name: 'Peer Teaching',
      description: `Prepare and deliver a mini-lesson on ${topic} to a small group of peers.`,
      duration: '25 minutes',
      materials: 'Presentation materials, whiteboard',
    },
    {
      name: 'Critical Analysis',
      description: `Analyze and critique different approaches to solving ${topic} problems.`,
      duration: '15-20 minutes',
      materials: 'Sample problems, analysis template',
    },
  ];

  return applyDifferentiation(baseActivities, differentiationType);
}

/**
 * Generates activities for Group B (achieving).
 */
function generateGroupBActivities(topic, subject, differentiationType) {
  const baseActivities = [
    {
      name: 'Practice Problems',
      description: `Solve a set of ${topic} problems with increasing complexity.`,
      duration: '20 minutes',
      materials: 'Worksheet, calculator',
    },
    {
      name: 'Application Task',
      description: `Apply ${topic} concepts to solve practical problems.`,
      duration: '15-20 minutes',
      materials: 'Problem cards, answer sheet',
    },
    {
      name: 'Collaborative Problem Solving',
      description: `Work in pairs to solve ${topic} problems, discussing strategies.`,
      duration: '20 minutes',
      materials: 'Problem sets, discussion guide',
    },
  ];

  return applyDifferentiation(baseActivities, differentiationType);
}

/**
 * Generates activities for Group C (needs support).
 */
function generateGroupCActivities(topic, subject, differentiationType) {
  const baseActivities = [
    {
      name: 'Guided Practice',
      description: `Work through ${topic} problems with step-by-step guidance and examples.`,
      duration: '25 minutes',
      materials: 'Guided worksheet, worked examples',
    },
    {
      name: 'Concept Reinforcement',
      description: `Use manipulatives or visual aids to reinforce ${topic} concepts.`,
      duration: '20 minutes',
      materials: 'Manipulatives, visual aids',
    },
    {
      name: 'Small Group Instruction',
      description: `Receive focused instruction on ${topic} in a small group setting.`,
      duration: '20 minutes',
      materials: 'Whiteboard, practice materials',
    },
  ];

  return applyDifferentiation(baseActivities, differentiationType);
}

/**
 * Generates activities for Group D (significant intervention needed).
 */
function generateGroupDActivities(topic, subject, differentiationType) {
  const baseActivities = [
    {
      name: 'Foundational Skills',
      description: `Build foundational understanding of ${topic} through concrete, hands-on activities.`,
      duration: '30 minutes',
      materials: 'Concrete materials, base-ten blocks, counters',
    },
    {
      name: 'Step-by-Step Instruction',
      description: `Receive highly structured, step-by-step instruction on ${topic} with frequent checks.`,
      duration: '25 minutes',
      materials: 'Structured worksheet, answer key',
    },
    {
      name: 'One-on-One Support',
      description: `Receive individualized support on ${topic} with immediate feedback.`,
      duration: '15-20 minutes',
      materials: 'Practice materials, feedback sheet',
    },
  ];

  return applyDifferentiation(baseActivities, differentiationType);
}

/**
 * Generates standard activities for mixed groups.
 */
function generateStandardActivities(topic, subject, differentiationType) {
  const baseActivities = [
    {
      name: 'Mixed Ability Group Work',
      description: `Collaborative activity on ${topic} with roles for different ability levels.`,
      duration: '20 minutes',
      materials: 'Activity cards, role descriptions',
    },
    {
      name: 'Tiered Task',
      description: `Choose from ${topic} tasks at different difficulty levels based on readiness.`,
      duration: '20 minutes',
      materials: 'Tiered task cards',
    },
    {
      name: 'Learning Stations',
      description: `Rotate through stations focusing on different aspects of ${topic}.`,
      duration: '25 minutes',
      materials: 'Station materials, rotation schedule',
    },
  ];

  return applyDifferentiation(baseActivities, differentiationType);
}

/**
 * Applies differentiation modifications to activities.
 *
 * @param {Array} activities - Base activities
 * @param {string} differentiationType - Type of differentiation
 * @returns {Array} Modified activities
 */
function applyDifferentiation(activities, differentiationType) {
  const modified = JSON.parse(JSON.stringify(activities)); // Deep copy

  switch (differentiationType) {
    case 'easier':
      modified.forEach(activity => {
        activity.description += ' Simplified with reduced complexity and additional support.';
        activity.duration = 'Add 5-10 minutes for additional support';
      });
      break;
    case 'harder':
      modified.forEach(activity => {
        activity.description += ' Increased complexity with extension challenges.';
        activity.duration = 'Add 5-10 minutes for deeper exploration';
      });
      break;
    case 'visual':
      modified.forEach(activity => {
        activity.description += ' Emphasizes visual learning with diagrams, charts, and graphic organizers.';
        activity.materials += ', visual aids, graphic organizers';
      });
      break;
    case 'oral':
      modified.forEach(activity => {
        activity.description += ' Focuses on oral discussion, verbal explanation, and auditory learning.';
        activity.materials += ', discussion prompts, audio materials';
      });
      break;
    case 'kinesthetic':
      modified.forEach(activity => {
        activity.description += ' Incorporates movement and hands-on learning experiences.';
        activity.materials += ', manipulatives, movement cards';
      });
      break;
    default:
      // No modification for standard
      break;
  }

  return modified;
}

/**
 * Generates a complete differentiated lesson plan.
 *
 * @param {string} topic - Lesson topic
 * @param {string} subject - Subject
 * @param {number} duration - Lesson duration in minutes
 * @returns {Object} Differentiated lesson plan
 */
function generateDifferentiatedLessonPlan(topic, subject, duration = 60) {
  const plan = {
    topic,
    subject,
    duration,
    phases: [
      {
        name: 'Introduction (10 minutes)',
        wholeClass: `Introduce ${topic} with a hook that engages all learners.`,
        differentiation: 'Use multiple representations (visual, oral, written) to reach different learning styles.',
      },
      {
        name: 'Direct Instruction (15 minutes)',
        wholeClass: `Teach core concepts of ${topic} with clear explanations.`,
        differentiation: 'Provide worked examples at different complexity levels. Use visual aids and verbal explanations.',
      },
      {
        name: 'Differentiated Activities (25 minutes)',
        wholeClass: 'Learners work on activities matched to their readiness level.',
        differentiation: 'Group A: Extension tasks. Group B: Application problems. Group C: Guided practice. Group D: Foundational skills with support.',
      },
      {
        name: 'Closure (10 minutes)',
        wholeClass: 'Review key concepts and assess understanding.',
        differentiation: 'Use exit tickets with different question types. Provide sentence starters for learners who need them.',
      },
    ],
  };

  return plan;
}

/**
 * Generates activity suggestions based on error patterns.
 *
 * @param {Array} errorPatterns - Error patterns from error analysis
 * @returns {Array} Targeted activity suggestions
 */
function generateTargetedActivities(errorPatterns) {
  const suggestions = [];

  for (const error of errorPatterns) {
    switch (error.errorType) {
      case 'conceptual':
        suggestions.push({
          problemArea: error.topic,
          activity: 'Concept Building',
          description: `Use concrete examples and real-world connections to build understanding of ${error.topic}.`,
          materials: 'Concrete materials, real-world examples, visual aids',
        });
        break;
      case 'procedural':
        suggestions.push({
          problemArea: error.topic,
          activity: 'Step-by-Step Practice',
          description: `Provide guided practice with worked examples for ${error.topic}. Break down procedures into clear steps.`,
          materials: 'Worked examples, step-by-step worksheets',
        });
        break;
      case 'misconception':
        suggestions.push({
          problemArea: error.topic,
          activity: 'Misconception Address',
          description: `Directly address common misconceptions about ${error.topic} through discussion and counter-examples.`,
          materials: 'Counter-examples, discussion prompts, misconception cards',
        });
        break;
      case 'language':
        suggestions.push({
          problemArea: error.topic,
          activity: 'Language Support',
          description: `Simplify language and provide vocabulary support for ${error.topic}. Use visual support and check for understanding.`,
          materials: 'Vocabulary lists, visual glossary, sentence frames',
        });
        break;
      case 'knowledge_gap':
        suggestions.push({
          problemArea: error.topic,
          activity: 'Foundational Review',
          description: `Review prerequisite knowledge and skills needed for ${error.topic}. Provide targeted remediation.`,
          materials: 'Prerequisite checklists, remediation materials',
        });
        break;
    }
  }

  return suggestions;
}

module.exports = {
  generateDifferentiatedActivities,
  generateDifferentiatedLessonPlan,
  generateTargetedActivities,
};
