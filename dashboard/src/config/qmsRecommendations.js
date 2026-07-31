// dashboard/src/config/qmsRecommendations.js
//
// Static, rule-based recommendation config for the QMS Action Centre
// (ADR-012). Keyed by category, then by `empty` (count === 0) or
// `populated` (count > 0).
//
// This is business policy, not UI logic — QMSCategoryActions.jsx should
// remain a pure renderer of whatever this file (or, eventually, a real
// qmsRecommendationService response) hands it. See ADR-012 §4.2/§4.3.
//
// CTA shape:
//   { label, type: 'route',      target: '<path>' }
//   { label, type: 'whatsapp',   command: '<command text>' }
//   { label, type: 'comingSoon' }

export const qmsRecommendations = {
  curriculum: {
    empty: {
      status: 'No curriculum evidence recorded yet this term.',
      recommendations: [
        'Generate a CAPS-aligned lesson plan',
        'Create a worksheet for an upcoming topic',
        'Record curriculum coverage as you teach',
      ],
      ctas: [
        { label: 'Generate Lesson Plan', type: 'whatsapp', command: 'lesson plan' },
        { label: 'Generate Worksheet', type: 'whatsapp', command: 'worksheet' },
      ],
    },
    populated: {
      status: 'Curriculum coverage is being tracked this term.',
      recommendations: [
        'Keep logging coverage as you complete topics',
        'Generate a worksheet for a topic you\u2019re about to teach',
      ],
      ctas: [
        { label: 'Generate Worksheet', type: 'whatsapp', command: 'worksheet' },
      ],
    },
  },

  assessment: {
    empty: {
      status: 'No assessments captured yet this term.',
      recommendations: [
        'Create your first assessment for this term',
        'Open a class to see who\u2019s due for assessment',
      ],
      ctas: [
        { label: 'View Assessments', type: 'route', target: '/assessments' },
        { label: 'Open Class', type: 'route', target: '/classes' },
      ],
    },
    populated: {
      status: 'Assessment evidence is being captured this term.',
      recommendations: [
        'Create another assessment this week',
        'Review learners who need extra support',
      ],
      ctas: [
        { label: 'View Assessments', type: 'route', target: '/assessments' },
        { label: 'Open Class', type: 'route', target: '/classes' },
      ],
    },
  },

  intervention: {
    empty: {
      status: 'No learner support plans recorded yet this term.',
      recommendations: [
        'Open a class to identify learners who may need support',
        'Capture an assessment to surface intervention needs automatically',
      ],
      ctas: [
        { label: 'Open Class', type: 'route', target: '/classes' },
      ],
    },
    populated: {
      status: 'Learner support plans are active this term.',
      recommendations: [
        'Review high-priority learners in each class',
        'Follow up on existing intervention plans',
      ],
      ctas: [
        { label: 'Open Class', type: 'route', target: '/classes' },
      ],
    },
  },

  observation: {
    empty: {
      status: 'No classroom observations recorded yet this term.',
      recommendations: [
        'Complete a classroom observation',
        'Capture developmental notes while they\u2019re fresh',
      ],
      ctas: [
        { label: 'Start Observation', type: 'whatsapp', command: 'start observation' },
      ],
    },
    populated: {
      status: 'Observation evidence is being captured this term.',
      recommendations: [
        'Capture another observation for a different class',
        'Review notes from your most recent observation',
      ],
      ctas: [
        { label: 'Start Observation', type: 'whatsapp', command: 'start observation' },
      ],
    },
  },

  resource: {
    empty: {
      status: 'No supporting resources saved yet this term.',
      recommendations: [
        'Save today\u2019s worksheet or lesson plan for reuse',
        'Build a small library of go-to resources',
      ],
      ctas: [
        { label: 'View My Resources', type: 'whatsapp', command: 'my resources' },
      ],
    },
    populated: {
      status: 'Resources are being saved this term.',
      recommendations: [
        'Keep saving resources as you create them',
        'Review your saved resources for reuse next term',
      ],
      ctas: [
        { label: 'View My Resources', type: 'whatsapp', command: 'my resources' },
      ],
    },
  },
};

export default qmsRecommendations;
