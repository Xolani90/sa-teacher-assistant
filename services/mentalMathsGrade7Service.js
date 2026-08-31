'use strict';
const senior = require('./mentalMathsService');
module.exports = { MIN_GRADE: 7, MAX_GRADE: 7, TOPICS: Object.fromEntries(senior.AUTHORIZED_FAMILIES.filter(f => senior.FAMILY_GRADE_AUTHORIZATION[f].includes(7)).map(f => [f, f])), isSupportedGrade: g => g === 7, generate: ({ count = 12, seed, topic }) => senior.generateFamilySession({ grade: 7, family: topic, count, seed }) };
