'use strict';
// Phase Classifier-Disambiguation — real-AI regression test for the new
// TYPE DEFINITIONS added to services/intentClassifier.js.
//
// Confirmed defect (this session): examPaper, rubric, sbaTask,
// moderationPack, dataAssessment, and curriculumQuery were valid classifier
// outputs (via VALID_TYPES auto-derived from intentParser.js) but had NO
// prose definition in the classifier's system prompt, and interventionPlan's
// definition explicitly claimed SBA guidance with nothing competing for
// sbaTask -- so real SBA task requests were likely being misclassified as
// interventionPlan by the live AI path (classifyIntent is the PRIMARY path;
// the regex parser in intentParser.js is only a fallback on timeout/error).
//
// This test calls the REAL classifyIntent() -> REAL Anthropic API, not a
// mock, because the defect lives entirely in prompt wording that only the
// model itself can be tested against. A regex/unit test would just prove
// the string was added, not that it works.
//
// REQUIRES: RUN_NETWORK_TESTS=1, plus ANTHROPIC_API_KEY (or OPENAI_API_KEY)
// in the environment. Loaded from .env here (unlike other tests in this
// suite, which fake their own env vars locally) because this is the first
// test that makes a real external API call rather than exercising
// local-only logic. Opt-in gated (like tests/payment-webhook-smoke.test.js's
// RUN_SMOKE_TESTS) because a present API key does not guarantee network
// reachability -- this suite SKIPS with exit code 0 by default so it never
// fails the standard `npm test` run.
//
// Run: node tests/phase-classifier-disambiguation.test.js

require('dotenv').config();

// Opt-in only: this suite makes real, paid AI API calls and requires
// outbound network access to api.anthropic.com. A present API key does
// NOT guarantee reachability (e.g. no network in this shell/CI job), so
// gate on an explicit flag rather than key presence alone -- same pattern
// as tests/payment-webhook-smoke.test.js's RUN_SMOKE_TESTS.
if (!process.env.RUN_NETWORK_TESTS) {
  console.log(
    'SKIPPED: phase-classifier-disambiguation.test.js ' +
    '(set RUN_NETWORK_TESTS=1 to run -- makes real AI API calls)'
  );
  process.exitCode = 0;
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
  console.log('\n⚠️  phase-classifier-disambiguation.test.js SKIPPED — no ANTHROPIC_API_KEY or OPENAI_API_KEY set.');
  console.log('   This suite makes real AI calls to verify classifier prompt wording and cannot run without a key.\n');
  process.exitCode = 0;
  process.exit(0);
}

const { classifyIntent } = require('../services/intentClassifier');

let passed = 0;
let failed = 0;

function check(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ FAIL: ${label}`); failed++; }
}

// Each case: the message, the expected type, and a human label for output.
// _source is logged (not asserted) so a run can be inspected for whether
// the real AI path answered or the regex fallback quietly caught it —
// a fallback hit here would mean the AI call itself failed, which is worth
// seeing even though it wouldn't fail the assertion (the regex parser
// already has its own correct coverage for these phrasings from earlier
// work, so a fallback source is not itself a defect this test checks for).
const cases = [
  {
    label: 'CD-01: SBA task document request → sbaTask, not interventionPlan',
    message: 'I need an SBA task on ecosystems for my grade 10 life sciences class',
    expectedType: 'sbaTask',
  },
  {
    label: 'CD-02: SBA advice/talk request → interventionPlan, not sbaTask',
    message: 'how should I weight my SBA tasks for this term, and how many should I set?',
    expectedType: 'interventionPlan',
  },
  {
    label: 'CD-03: rubric-only request → rubric, not test/worksheet',
    message: 'just give me a marking rubric for the persuasive essay task, no need for the task itself',
    expectedType: 'rubric',
  },
  {
    label: 'CD-04: formal exam paper → examPaper, not test',
    message: 'I need a mid-year exam paper for grade 11 maths, with a full memo',
    expectedType: 'examPaper',
  },
  {
    label: 'CD-05: ordinary classroom test → test, not examPaper',
    message: 'give me a 30 mark test on quadratic equations for grade 10',
    expectedType: 'test',
  },
  {
    label: 'CD-06: moderation pack request → moderationPack, not sbaTask/rubric',
    message: 'I need a moderation pack for my grade 9 English SBA task, for HOD sign-off',
    expectedType: 'moderationPack',
  },
  {
    label: 'CD-07: curriculum status question → curriculumQuery, not atp',
    message: 'am I behind on the curriculum for grade 8 natural sciences this term?',
    expectedType: 'curriculumQuery',
  },
  {
    label: 'CD-08: annual teaching plan request → atp, not curriculumQuery',
    message: 'can you give me the annual teaching plan for grade 8 natural sciences',
    expectedType: 'atp',
  },
];

(async () => {
  console.log('\n── Classifier disambiguation: real AI calls against the fixed prompt ──\n');

  for (const testCase of cases) {
    let result;
    try {
      result = await classifyIntent(testCase.message);
    } catch (err) {
      check(false, `${testCase.label} (threw: ${err.message})`);
      continue;
    }

    console.log(`     "${testCase.message}"`);
    console.log(`     → type=${result.type} (source=${result._source})`);
    check(result.type === testCase.expectedType, testCase.label);
  }

  console.log('\n─────────────────────────────────');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total:  ${passed + failed}`);
  console.log('─────────────────────────────────\n');

  process.exitCode = failed > 0 ? 1 : 0;
})();
