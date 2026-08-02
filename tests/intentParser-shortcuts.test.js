'use strict';

const { parseIntent, INTENT_TYPES } = require('../utils/intentParser');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

console.log('📋 TEST 1: Classification — REFLECT shortcut');
check('"REFLECT" -> REFLECTION', parseIntent('REFLECT').type === INTENT_TYPES.REFLECTION);
check('"reflect" (lowercase) -> REFLECTION', parseIntent('reflect').type === INTENT_TYPES.REFLECTION);
check('"REFLECT." (trailing period) -> REFLECTION', parseIntent('REFLECT.').type === INTENT_TYPES.REFLECTION);

console.log('📋 TEST 2: Classification — NEW GOAL shortcut');
check('"NEW GOAL" -> GROWTH_PLAN', parseIntent('NEW GOAL').type === INTENT_TYPES.GROWTH_PLAN);
check('"new goal" (lowercase) -> GROWTH_PLAN', parseIntent('new goal').type === INTENT_TYPES.GROWTH_PLAN);
check('"NEW GOAL." (trailing period) -> GROWTH_PLAN', parseIntent('NEW GOAL.').type === INTENT_TYPES.GROWTH_PLAN);

console.log('📋 TEST 3: Equivalence — shortcuts resolve to the same intent as existing phrasing');
check(
  '"REFLECT" and "reflect on my lesson" produce the same intent type',
  parseIntent('REFLECT').type === parseIntent('reflect on my lesson').type
);
check(
  '"NEW GOAL" and "create a growth plan" produce the same intent type',
  parseIntent('NEW GOAL').type === parseIntent('create a growth plan').type
);

console.log('📋 TEST 4: Non-regression — existing natural-language phrases still work');
check('"log a reflection" -> REFLECTION', parseIntent('log a reflection').type === INTENT_TYPES.REFLECTION);
check('"record a reflection" -> REFLECTION', parseIntent('record a reflection').type === INTENT_TYPES.REFLECTION);
check('"reflect on this lesson" -> REFLECTION', parseIntent('reflect on this lesson').type === INTENT_TYPES.REFLECTION);
check('"growth plan" -> GROWTH_PLAN', parseIntent('growth plan').type === INTENT_TYPES.GROWTH_PLAN);
check('"development plan" -> GROWTH_PLAN', parseIntent('development plan').type === INTENT_TYPES.GROWTH_PLAN);
check('"professional growth" -> GROWTH_PLAN', parseIntent('professional growth').type === INTENT_TYPES.GROWTH_PLAN);

console.log('📋 TEST 5: Anchoring — shortcuts do not misfire on unrelated text containing the words');
check(
  '"let me reflect on that decision" is NOT classified as REFLECTION via the bare-shortcut anchor (still falls to natural-language branch, which does not match "reflect on that decision")',
  parseIntent('let me reflect on that decision').type !== INTENT_TYPES.REFLECTION
);
check(
  '"what is my goal for this term" is NOT classified as GROWTH_PLAN (mid-sentence "goal" does not match the anchored ^new\\s+goal$)',
  parseIntent('what is my goal for this term').type !== INTENT_TYPES.GROWTH_PLAN
);

console.log('─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('─────────────────────────────────');

if (failed > 0) {
  process.exit(1);
}
