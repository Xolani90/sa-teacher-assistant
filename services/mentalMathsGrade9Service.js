'use strict';
const senior = require('./mentalMathsService');
module.exports = { MIN_GRADE: 9, MAX_GRADE: 9, TOPICS: Object.fromEntries(senior.AUTHORIZED_FAMILIES.filter(f => senior.FAMILY_GRADE_AUTHORIZATION[f].includes(9)).map(f => [f, f])), isSupportedGrade: g => g === 9, generate: ({ count = 12, seed, topic }) => senior.generateFamilySession({ grade: 9, family: topic, count, seed }) };
