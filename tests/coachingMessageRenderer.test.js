'use strict';
/**
 * coachingMessageRenderer Tests (PR40, ADR-018)
 *
 * Since the ADR-018 §5 dependency-inversion cleanup, coachingMessageRenderer
 * no longer requires coachingEngineService at all — it is a pure
 * `messageId -> template` module with zero knowledge of the engine.
 * Cross-module consistency (every rule's messageId has a template, and
 * vice versa) is verified two ways in this file:
 *
 *   1. renderRecommendation() produces the correct string per messageId
 *   2. an unknown messageId throws rather than silently falling back
 *   3. validateMessageTemplates() accepts a matched rule/template set
 *   4. validateMessageTemplates() rejects a rule with no template
 *   5. validateMessageTemplates() rejects a template with no rule
 *   6. Test V-04 below explicitly calls validateMessageTemplates()
 *      against the real, live RECOMMENDATION_RULES catalogue — this is
 *      no longer implicit in module load (that self-check moved to
 *      utils/startupChecks.js, the one place both modules are required
 *      together, run once at server boot).
 *
 * Run individually:   node tests/coachingMessageRenderer.test.js
 * Run via npm:         npm test
 */

// ── Real-migrations test DB (see tests/helpers/createTestDb.js) ──────────
// Test V-04 below requires coachingEngineService directly (to exercise
// the real RECOMMENDATION_RULES catalogue), which requires the database
// layer — a DB must exist in scope before that require runs. This is a
// test-only dependency, not something coachingMessageRenderer itself has.
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

function assertEq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    console.error(`     expected: ${JSON.stringify(b)}`);
    console.error(`     got:      ${JSON.stringify(a)}`);
    failed++;
  }
}

async function run() {
  const {
    MESSAGE_TEMPLATES,
    renderRecommendation,
    validateMessageTemplates,
  } = require('../services/coachingMessageRenderer');
  const { RECOMMENDATION_RULES } = require('../services/coachingEngineService');

  console.log('\nSection 1: renderRecommendation() — one assertion per registered template');

  console.log('\nTest R-01: growth_plan_missing renders with the topic label substituted');
  {
    const result = renderRecommendation({
      messageId: 'growth_plan_missing',
      templateData: { topicLabel: 'Fractions' },
    });
    assertEq(
      result,
      "You have identified a recurring pattern in Fractions but don't yet have an active growth plan.",
      'growth_plan_missing renders the exact PR36 wording, topic label substituted'
    );
  }

  console.log('\nTest R-02: trend_falling renders with the topic label substituted (extra templateData fields ignored)');
  {
    const result = renderRecommendation({
      messageId: 'trend_falling',
      templateData: { topicLabel: 'Fractions', currentConfidence: 0.5, previousConfidence: 0.8 },
    });
    assertEq(
      result,
      'Your confidence in Fractions has declined since your last check-in. Consider revisiting this area soon.',
      'trend_falling renders the exact PR39 wording — extra fields in templateData are simply unused, not an error'
    );
  }

  console.log('\nTest R-03: low_confidence_recommendation renders with no topic substitution at all');
  {
    const result = renderRecommendation({
      messageId: 'low_confidence_recommendation',
      templateData: {},
    });
    assertEq(
      result,
      'Evidence is currently limited for this recommendation. Continue recording reflections before making major changes.',
      'low_confidence_recommendation has no per-topic wording, matching its original engine-composed string'
    );
  }

  console.log('\nTest R-04: every messageId in the live catalogue renders without throwing');
  {
    let anyThrew = false;
    for (const rule of RECOMMENDATION_RULES) {
      try {
        renderRecommendation({ messageId: rule.messageId, templateData: { topicLabel: 'Topic' } });
      } catch (e) {
        anyThrew = true;
      }
    }
    assert(!anyThrew, 'all 8 registered messageIds render successfully with minimal templateData');
  }

  console.log('\nSection 2: renderRecommendation() failure mode');

  console.log('\nTest F-01: an unknown messageId throws rather than returning a fallback string');
  {
    let threw = false;
    try {
      renderRecommendation({ messageId: 'not_a_real_message_id', templateData: {} });
    } catch (e) {
      threw = true;
      assert(e.message.includes('not_a_real_message_id'), 'error message names the offending messageId');
    }
    assert(threw, 'renderRecommendation() throws on an unregistered messageId');
  }

  console.log('\nTest F-02: a recommendation with no messageId at all throws, not a crash on undefined');
  {
    let threw = false;
    try {
      renderRecommendation({ templateData: {} });
    } catch (e) {
      threw = true;
    }
    assert(threw, 'missing messageId is treated the same as an unknown one — a thrown, named error');
  }

  console.log('\nSection 3: validateMessageTemplates()');

  console.log('\nTest V-01: a matched rule/template set passes validation');
  {
    let threw = false;
    try {
      validateMessageTemplates(
        [{ id: 'a', messageId: 'x' }],
        { x: () => 'hello' }
      );
    } catch (e) {
      threw = true;
    }
    assert(!threw, 'a 1:1 matched set does not throw');
  }

  console.log('\nTest V-02: a rule referencing a messageId with no template fails validation');
  {
    let threw = false;
    try {
      validateMessageTemplates(
        [{ id: 'a', messageId: 'missing_template' }],
        { x: () => 'hello' }
      );
    } catch (e) {
      threw = true;
      assert(e.message.includes('missing_template'), 'error names the offending messageId');
      assert(e.message.includes('a'), 'error names the offending rule id');
    }
    assert(threw, 'a rule with no matching template fails loudly');
  }

  console.log('\nTest V-03: a template with no corresponding rule messageId fails validation');
  {
    let threw = false;
    try {
      validateMessageTemplates(
        [{ id: 'a', messageId: 'x' }],
        { x: () => 'hello', orphan_template: () => 'unused' }
      );
    } catch (e) {
      threw = true;
      assert(e.message.includes('orphan_template'), 'error names the orphaned template');
    }
    assert(threw, 'an unreferenced template fails loudly rather than silently accumulating dead code');
  }

  console.log('\nTest V-04: the real, live RECOMMENDATION_RULES catalogue passes validation against MESSAGE_TEMPLATES');
  {
    let threw = false;
    try {
      validateMessageTemplates(RECOMMENDATION_RULES, MESSAGE_TEMPLATES);
    } catch (e) {
      threw = true;
    }
    assert(!threw, 'every live rule has a template and every template has a live rule — exact 1:1, per ADR-018 Phase 1');
  }

  console.log('\nTest V-05: every rule in the live catalogue has a messageId equal to its ruleId (documented 1:1 today, ADR-018 §2)');
  {
    const allMatch = RECOMMENDATION_RULES.every((rule) => rule.messageId === rule.id);
    assert(allMatch, 'ruleId and messageId are identical for every rule today — the fields are independent in principle, not yet in practice');
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`coachingMessageRenderer Results: ${passed} passed, ${failed} failed`);
  testDb.cleanup();
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
