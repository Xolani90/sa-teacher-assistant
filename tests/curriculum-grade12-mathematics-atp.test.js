'use strict';

const {
resolveCurrentTopic,
getTermTopics,
} = require('../services/curriculumIntelligenceService');

let passed = 0;
let failed = 0;

function check(condition, label, extra) {
if (condition) {
console.log(`  ✅ ${label}`);
passed++;
} else {
console.error(`  ❌ FAIL: ${label}${extra !== undefined ? ' -- ' + extra : ''}`);
failed++;
}
}

console.log('\n── Grade 12 Mathematics ATP term/topic regression (Cycle 41) ──\n');

const AUTHORITATIVE_TERM_TOPICS = {
1: ['Patterns, sequences & series', 'Functions', 'Trigonometry'],
2: ['Euclidean geometry', 'Analytical geometry', 'Differential Calculus'],
3: ['Finance, growth & decay', 'Statistics', 'Counting & probability'],
4: ['Revision'],
};

for (const term of [1, 2, 3, 4]) {
const actual = getTermTopics(12, 'mathematics', term);
const expected = AUTHORITATIVE_TERM_TOPICS[term];

check(
JSON.stringify(actual) === JSON.stringify(expected),
`Term ${term}: exact authoritative topic set`,
JSON.stringify({ actual, expected })
);
}

const REPRESENTATIVE_DATES = {
1: ['2026-01-16', '2026-02-06', '2026-03-25'],
2: ['2026-04-10', '2026-05-01', '2026-06-17'],
3: ['2026-07-22', '2026-08-05', '2026-08-24'],
4: ['2026-10-07', '2026-10-21', '2026-11-25'],
};

for (const [term, dates] of Object.entries(REPRESENTATIVE_DATES)) {
const termNum = Number(term);
const ownTopics = new Set(AUTHORITATIVE_TERM_TOPICS[termNum]);

for (const iso of dates) {
const resolved = resolveCurrentTopic(
12,
'mathematics',
new Date(`${iso}T09:00:00`)
);

check(
  !!resolved &&
  resolved.term === termNum &&
  ownTopics.has(resolved.topic),
  `${iso}: resolves within corrected Term ${termNum}`,
  JSON.stringify(resolved)
);
}
}

const OLD_DEFECTS = [
[1, 'Finance'],
[1, 'Euclidean geometry'],
[2, 'Finance'],
[2, 'Sequences & series'],
[2, 'Statistics'],
[3, 'Trigonometry'],
[3, 'Euclidean geometry'],
[3, 'Analytical geometry'],
[4, 'Trigonometry'],
[4, 'Euclidean geometry'],
[4, 'Analytical geometry'],
[4, 'Statistics'],
[4, 'Probability'],
[4, 'Calculus'],
];

for (const [term, bad] of OLD_DEFECTS) {
check(
!getTermTopics(12, 'mathematics', term).includes(bad),
`Term ${term} excludes old incorrect topic "${bad}"`
);
}

check(
JSON.stringify(getTermTopics(12, 'mathematics', 4)) === JSON.stringify(['Revision']),
'Term 4 is exactly Revision'
);

const isolationCases = [
[7, 2, ['Exponents', 'Integers', 'Numeric and geometric patterns', 'Functions and relationships']],
[8, 2, ['Exponents', 'Algebraic expressions', 'Algebraic equations', 'Functions and relationships', 'Graphs']],
[9, 3, ['Geometry of 2D shapes', 'Area and perimeter', 'Data handling', 'Probability']],
[10, 1, ['Algebraic expressions', 'Exponents', 'Equations & inequalities', 'Trigonometry']],
[11, 2, ['Euclidean geometry', 'Analytical geometry', 'Functions']],
];

for (const [grade, term, expected] of isolationCases) {
const actual = getTermTopics(grade, 'mathematics', term);

check(
JSON.stringify(actual) === JSON.stringify(expected),
`Grade ${grade} Term ${term} taxonomy is unchanged`
);
}

console.log(`\nGrade 12 Mathematics ATP Regression Results: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exitCode = 1;
