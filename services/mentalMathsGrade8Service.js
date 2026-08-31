'use strict';
const senior = require('./mentalMathsService');
module.exports = { MIN_GRADE: 8, MAX_GRADE: 8, TOPICS: Object.fromEntries(senior.AUTHORIZED_FAMILIES.filter(f => senior.FAMILY_GRADE_AUTHORIZATION[f].includes(8)).map(f => [f, f])), isSupportedGrade: g => g === 8, generate: ({ count = 12, seed, topic }) => senior.generateFamilySession({ grade: 8, family: topic, count, seed }) };
