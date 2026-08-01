'use strict';

require('dotenv').config();

/**
 * seedVariedAnalyticsClass.js
 *
 * Seeds a second class deliberately designed to stress-test the three
 * flagged assumptions in classAnalyticsService.js (ADR-013):
 *
 *   1. MASTERY_LEVEL_SCORE (beginning/developing/secure/advanced -> 25/50/75/100)
 *      -> needs learners spread across multiple mastery levels, not
 *         uniformly "developing" like the existing seed class.
 *   2. progress distribution buckets (ProgressReport.trend verbatim)
 *      -> needs learners with >=2 assessment events each, spaced apart
 *         with different score deltas, so trend actually computes to
 *         "rising"/"falling"/"flat" instead of always "insufficient-data".
 *   3. coverage distribution buckets (LOW/HIGH_COVERAGE_THRESHOLD 40/70)
 *      -> needs blueprint-backed assessments whose question topics
 *         actually match CAPS expected topics for the grade/subject/term,
 *         so dataAvailable=true and coveragePercentage varies across the
 *         low/developing/high bands.
 *
 * This script does NOT touch the existing seed class (id=2) — it inserts
 * a new class and roster.
 *
 * Usage:
 *   node seedVariedAnalyticsClass.js
 *
 * Uses the phone_hash of the existing (only) teacher row directly —
 * hardcoded below — rather than re-deriving it via hashPhone(rawPhone),
 * so you don't need to remember which raw number you originally used.
 * Confirmed via: SELECT id, phone_hash FROM teachers;
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'teacher_assistant.db');

// Known-good phone_hash matching the existing row in `teachers` —
// confirmed via `SELECT id, phone_hash FROM teachers` before running this.
const phoneHash = 'c303876569ab3c93a48e245f2415b2a052d82847b7d4d6e40f788adb1d7a6ec1';

const db = new Database(DB_PATH);

const GRADE = 6;
const TERM = 2;
const SUBJECT = 'Mathematics';

function seed() {
  const insertClass = db.prepare(`
    INSERT INTO classes (phone_hash, name, grade, subject, learner_count)
    VALUES (?, ?, ?, ?, 0)
  `);
  const classResult = insertClass.run(phoneHash, 'Grade 6B Mathematics (Analytics Stress Test)', GRADE, SUBJECT);
  const classId = classResult.lastInsertRowid;

  const insertLearner = db.prepare(`
    INSERT INTO learners (phone_hash, class_id, canonical_name, normalized_name)
    VALUES (?, ?, ?, ?)
  `);

  // Each learner is designed to land in a specific mastery band and a
  // specific progress trend, so the distributions actually spread out.
  //
  // scores: chronological list of percentages (oldest first) fed as
  // separate assessment events -> lets trend compute for real.
  // topicsCompleted: subset of a 4-topic CAPS list, controlling coverage%.
  const learnerSpecs = [
    { name: 'Aisha Petersen',   scores: [30, 25],  topicsCovered: 0 }, // beginning, falling, low coverage
    { name: 'Bongani Zulu',     scores: [40, 55],  topicsCovered: 1 }, // developing, rising, low-ish coverage
    { name: 'Chloe van der Merwe', scores: [72, 70], topicsCovered: 3 }, // secure, flat, high coverage
    { name: 'Dumisani Ngcobo',  scores: [88, 95],  topicsCovered: 4 }, // advanced, rising, high coverage
    { name: 'Emma Botha',       scores: [58, 42],  topicsCovered: 2 }, // developing, falling, developing coverage
  ];

  const CAPS_TOPICS = ['Whole Numbers', 'Common Fractions', 'Data Handling', 'Geometry'];

  // We need an assessment_blueprints row so assessments are blueprint-backed
  // (coverage requires blueprintId != null per coverageService.filterCoverageEvents).
  const insertBlueprint = db.prepare(`
    INSERT INTO assessment_blueprints (phone_hash, title, grade, subject, term, total_marks, status, version)
    VALUES (?, ?, ?, ?, ?, ?, 'published', 1)
  `);
  const blueprintResult = insertBlueprint.run(
    phoneHash, 'Analytics Stress Test Assessment', GRADE, SUBJECT, TERM, 20
  );
  const blueprintId = blueprintResult.lastInsertRowid;

  const insertBlueprintQuestion = db.prepare(`
    INSERT INTO blueprint_questions (blueprint_id, question_number, max_marks, topic)
    VALUES (?, ?, ?, ?)
  `);
  CAPS_TOPICS.forEach((topic, i) => {
    insertBlueprintQuestion.run(blueprintId, i + 1, 5, topic);
  });

  const insertAssessment = db.prepare(`
    INSERT INTO assessments (phone_hash, class_id, title, grade, subject, term, assessment_type, total_marks, blueprint_id, blueprint_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'test', ?, ?, 1, ?)
  `);
  const insertResult = db.prepare(`
    INSERT INTO learner_results (assessment_id, learner_id, learner_name, mark, total_marks, percentage, question_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedTxn = db.transaction(() => {
    learnerSpecs.forEach((spec) => {
      const learner = insertLearner.run(phoneHash, classId, spec.name, spec.name.trim().toLowerCase());
      const learnerId = learner.lastInsertRowid;

      // question_data: plain { questionNumber: marksAwarded }, matching
      // blueprintAnalytics.js's documented shape for blueprint-backed
      // assessments (see patch1.js/patch2.js history).
      spec.scores.forEach((pct, eventIndex) => {
        // Stagger created_at so points are chronologically distinct —
        // oldest first, ~1 day apart.
        const daysAgo = spec.scores.length - eventIndex;
        const createdAt = `datetime('now', '-${daysAgo} days')`;

        const createdAtValue = db.prepare(`SELECT ${createdAt} AS d`).get().d;

        const assessment = insertAssessment.run(
          phoneHash, classId,
          `Mathematics Test ${eventIndex + 1} (Seed)`,
          GRADE, SUBJECT, TERM, 20, blueprintId,
          createdAtValue
        );
        const assessmentId = assessment.lastInsertRowid;

        // Award full marks (5/5) on the first spec.topicsCovered questions
        // — these are the ones intended to read as "completed" for
        // coverage purposes (coverageService presumably treats
        // awarded===maxMarks as topic-complete; verify this assumption
        // against resolveEventTopics() once real numbers come back).
        // Remaining questions get partial marks scaled so the assessment
        // totals close to the target pct, without ever hitting 5/5 (so
        // they don't get miscounted as completed).
        const targetTotal = 20 * (pct / 100);
        const questionData = {};
        const fullMarkTotal = spec.topicsCovered * 5;
        const remainingQuestions = 4 - spec.topicsCovered;
        const remainingTarget = Math.max(0, targetTotal - fullMarkTotal);
        const perRemaining = remainingQuestions > 0
          ? Math.min(4, remainingTarget / remainingQuestions) // cap at 4 so never "full"
          : 0;

        for (let q = 1; q <= 4; q++) {
          questionData[q] = q <= spec.topicsCovered ? 5 : Math.round(perRemaining);
        }
        const actualMark = Object.values(questionData).reduce((a, b) => a + b, 0);
        const actualPct = Math.round((actualMark / 20) * 100);

        insertResult.run(
          assessmentId, learnerId, spec.name, actualMark, 20, actualPct,
          JSON.stringify(questionData),
          createdAtValue
        );
      });
    });

    db.prepare(`UPDATE classes SET learner_count = ? WHERE id = ?`)
      .run(learnerSpecs.length, classId);
  });

  seedTxn();

  console.log(`[seed] Created class id=${classId} ("Grade 6B Mathematics (Analytics Stress Test)")`);
  console.log(`[seed] Blueprint id=${blueprintId}, ${CAPS_TOPICS.length} topics`);
  console.log(`[seed] ${learnerSpecs.length} learners seeded with 2 assessments each:`);
  learnerSpecs.forEach((s) => console.log(`  - ${s.name}: scores ${s.scores.join(' -> ')}`));
  console.log('');
  console.log('Next: run getClassAnalytics against this classId to check:');
  console.log(`  node -e "const {getClassAnalytics}=require('./services/classAnalyticsService'); console.log(JSON.stringify(getClassAnalytics('${phoneHash}', ${classId}), null, 2))"`);
}

seed();
db.close();
