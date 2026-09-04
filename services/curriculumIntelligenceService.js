'use strict';

/**
 * Curriculum Intelligence Service
 * Understands the SA school calendar, ATP pacing, and curriculum coverage.
 * Powers Module 1 (Curriculum Intelligence Engine) of Part 3.
 */

const { gradeLabel } = require('../utils/capsPhase');

// ── SA School Calendar (approximated; adjust per WCED/DBE circulars each year) ──
// Structure: { term: { start: [month-1, day], end: [month-1, day], weeks: N } }
const SA_SCHOOL_CALENDAR = {
  2025: {
    1: { start: [0, 15], end: [2, 28], weeks: 11 },
    2: { start: [3, 7],  end: [5, 20], weeks: 11 },
    3: { start: [6, 21], end: [8, 26], weeks: 10 },
    4: { start: [9, 6],  end: [11, 5], weeks: 9  },
  },
  2026: {
    1: { start: [0, 14], end: [2, 27], weeks: 11 },
    2: { start: [3, 8],  end: [5, 19], weeks: 11 },
    3: { start: [6, 20], end: [8, 25], weeks: 10 },
    4: { start: [9, 5],  end: [11, 4], weeks: 9  },
  },
};

// ── CAPS Topics — expanded to cover all common SA subjects & grades ──────────
const CAPS_TOPICS = {
  // NOTE (Grades 8-9 fixed — see PROJECT_STATUS.md "ATP/lesson-plan topic
  // drift"; Grade 7 corrected in Cycle 33):
  // Grades 7-9 previously repeated almost the SAME full-year topic list in
  // all 4 terms (e.g. "Algebraic equations" appeared in every term's array
  // for Grade 7), so any code trusting this table as "what's the current
  // topic" could return a topic from the wrong term entirely. Grades 8-9
  // were re-derived from the official 2026 DBE Senior Phase Mathematics
  // ATPs (education.gov.za) and directly verified term-by-term against
  // those documents — each topic appears only in the term it is actually
  // taught in. Grade 7's original "re-derivation" claimed the same but was
  // NOT actually correct: it de-duplicated topics across terms but placed
  // several of them in the wrong term (e.g. "Integers" was listed under
  // Term 1 when the ATP places it in Term 2) and included topics that
  // don't belong to Grade 7 at all ("Algebraic expressions"/"Graphs" are
  // Grade 8/9 topics; "Measurement — time/distance/speed" and
  // "Probability" aren't in the Grade 7 ATP). Grade 7 below has now been
  // corrected against a directly gov.za-hosted Grade 7 Mathematics ATP
  // (2023/24, content confirmed unchanged into 2026 via a corroborating
  // 2026 copy). "Geometric constructions" is kept as-worded (rather than
  // the ATP's "Construction of geometric figures") because existing tests
  // (tests/rc1-lessonplan-dispatch.test.js,
  // tests/feature2-lessonplan-homework-e2e-journey.test.js) pin that exact
  // string as the resolved topic for Grade 7 Mathematics, 2026-08-05 — it
  // is the same real ATP topic, just a repository naming choice.
  // FET (10-12): Grade 10 had the SAME term-misplacement defect as the
  // original Grade 7 problem (e.g. "Euclidean geometry" was listed under
  // Term 1 when the official ATP places it in Term 2) plus unsupported
  // Term 4 content that isn't in the ATP at all — it was NOT "already
  // term-specific and unchanged" as a prior version of this comment
  // claimed. Grade 10 has now been corrected against a directly
  // gov.za-hosted Grade 10 Mathematics ATP (2023/24 official prior-year
  // evidence — no 2026-dated official Grade 10 document was located).
  // Grade 11 had the same class of term-misplacement defect (e.g.
  // "Euclidean geometry" and "Functions" listed under Term 1 when the
  // official ATP places them in Term 2) plus a fabricated Term 4 taxonomy
  // that didn't match the ATP's actual revision-term content. Grade 11 has
  // now been corrected against a directly gov.za-hosted Grade 11
  // Mathematics ATP (2023/24 official prior-year evidence — no 2026-dated
  // official Grade 11 document was located/checked).
  // Grade 12 has NOT been audited or corrected and its accuracy is
  // unverified.
  mathematics: {
    7: {
      1: ['Whole numbers','Common fractions','Decimal fractions'],
      2: ['Exponents','Integers','Numeric and geometric patterns','Functions and relationships'],
      3: ['Geometric constructions','Geometry of straight lines','Geometry of 2D shapes','Transformation geometry'],
      4: ['Area and perimeter of 2D shapes','Surface area and volume of 3D objects','Data handling'],
    },
    8: {
      1: ['Whole numbers','Integers','Common fractions','Decimal fractions','Numeric and geometric patterns'],
      2: ['Exponents','Algebraic expressions','Algebraic equations','Functions and relationships','Graphs'],
      3: ['Data handling','Geometry of straight lines','Geometry of 2D shapes','Probability'],
      4: ['Theorem of Pythagoras','Transformation geometry','Area and perimeter of 2D shapes','Surface area and volume of 3D objects'],
    },
    9: {
      1: ['Whole numbers','Integers','Exponents','Numeric and geometric patterns','Functions and relationships','Algebraic expressions'],
      2: ['Algebraic expressions','Algebraic equations','Graphs','Geometry of straight lines'],
      3: ['Geometry of 2D shapes','Area and perimeter','Data handling','Probability'],
      4: ['Geometry of 3D objects','Surface area and volume of 3D objects','Transformation geometry'],
    },
    10: {
      1: ['Algebraic expressions','Exponents','Equations & inequalities','Trigonometry'],
      2: ['Euclidean geometry','Analytical geometry','Functions'],
      3: ['Trigonometry','Statistics','Probability','Finance & growth'],
      4: ['Measurement','Number patterns'],
    },
    11: {
      1: ['Exponents & surds','Equations & inequalities','Trigonometry'],
      2: ['Euclidean geometry','Analytical geometry','Functions'],
      3: ['Trigonometry','Statistics','Probability','Finance, growth & decay'],
      4: ['Number patterns','Revision of measurement','Revision of Algebra','Revision of Trigonometry'],
    },
    12: {
      1: ['Patterns, sequences & series','Functions','Logarithms','Finance','Trigonometry','Euclidean geometry'],
      2: ['Finance','Sequences & series','Functions','Trigonometry','Analytical geometry','Euclidean geometry','Statistics'],
      3: ['Trigonometry','Euclidean geometry','Analytical geometry','Statistics','Probability'],
      4: ['Trigonometry','Euclidean geometry','Analytical geometry','Statistics','Probability','Calculus'],
    },
  },
  english: {
    7:  { 1: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          2: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          3: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          4: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'] },
    8:  { 1: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          2: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          3: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          4: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'] },
    9:  { 1: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          2: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          3: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          4: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'] },
    10: { 1: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          2: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          3: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          4: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'] },
    11: { 1: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          2: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          3: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          4: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'] },
    12: { 1: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          2: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          3: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'],
          4: ['Listening & speaking','Reading & viewing','Writing & presenting','Language structures & conventions'] },
  },
  natural_sciences: {
    7: {
      1: ['Life & living — ecosystems','Matter & materials — solids, liquids, gases','Energy & change — electrical cells'],
      2: ['Life & living — reproduction in plants & animals','Matter & materials — mixtures','Energy & change — electrical circuits'],
      3: ['Life & living — human body systems','Matter & materials — acids & bases','Earth & beyond — solar system'],
      4: ['Life & living — biosphere','Matter & materials — separating mixtures','Earth & beyond — universe'],
    },
    8: {
      1: ['Life & living — photosynthesis','Matter & materials — chemical reactions','Energy & change — energy transfers'],
      2: ['Life & living — biodiversity','Matter & materials — periodic table','Energy & change — waves'],
      3: ['Life & living — nutrition','Matter & materials — chemical equations','Earth & beyond — earth structure'],
      4: ['Life & living — cellular respiration','Matter & materials — hydrocarbons','Earth & beyond — climate'],
    },
    9: {
      1: ['Life & living — genetics','Matter & materials — bonding','Energy & change — electromagnetism'],
      2: ['Life & living — evolution','Matter & materials — chemical equations','Energy & change — electricity'],
      3: ['Life & living — ecology','Matter & materials — organic chemistry','Earth & beyond — resources'],
      4: ['Life & living — human impact','Matter & materials — materials','Earth & beyond — sustainable development'],
    },
  },
  physical_sciences: {
    10: {
      1: ['Mechanics — motion','Vectors & scalars','Newton\'s laws','Work, energy & power'],
      2: ['Matter & materials — atomic structure','Chemical bonding','Transverse pulses & waves','Longitudinal waves'],
      3: ['Chemical change — reactions','Acids & bases','Electric circuits'],
      4: ['Electromagnetic radiation','Chemical systems','Mechanical systems'],
    },
    11: {
      1: ['Vectors in 2D','Newton\'s laws (2D)','Electrostatics','Electric circuits'],
      2: ['Geometrical optics','2D & 3D wavefronts','Organic molecules','Representing chemicals'],
      3: ['Chemical equilibrium','Acids & bases','Electrochemical reactions'],
      4: ['Mechanics — work, energy, power','Doppler effect','Rate & extent of reactions'],
    },
    12: {
      1: ['Momentum & impulse','Vertical projectile','Electrodynamics','Optical phenomena'],
      2: ['Chemical equilibrium','Acids & bases','Electrochemistry','Organic chemistry'],
      3: ['Mechanics — revision','Electronic properties','Fertilisers','Chemical industry'],
      4: ['Revision — mechanics','Revision — electricity','Revision — chemistry'],
    },
  },
  life_sciences: {
    10: {
      1: ['Chemistry of life','Cells — the basic unit of life','Cell division'],
      2: ['Plant & animal tissues','Support & transport in plants','Support systems in animals'],
      3: ['Biodiversity & classification','Biosphere to ecosystems'],
      4: ['Animal nutrition','Plant nutrition','Population ecology'],
    },
    11: {
      1: ['Gaseous exchange in plants & animals','Excretion in animals'],
      2: ['Nervous system','Endocrine system','Homeostasis'],
      3: ['Reproduction in plants','Human reproduction'],
      4: ['Evolution by natural selection','Genetics & inheritance'],
    },
    12: {
      1: ['Meiosis','Genetics','DNA — code of life'],
      2: ['Human evolution','Human population & sustainability'],
      3: ['Immune system','Biodiversity & conservation'],
      4: ['Revision topics'],
    },
  },
  history: {
    7:  { 1: ['Early societies','Ancient Egypt'],  2: ['Greek world','Roman world'],  3: ['Medieval world'],  4: ['Early Modern period'] },
    8:  { 1: ['Indigenous societies of SA','Slavery'],  2: ['Colonialism in SA'],  3: ['Industrialisation'],  4: ['World War I'] },
    9:  { 1: ['World War II'],  2: ['Cold War'],  3: ['Apartheid — introduction'],  4: ['Resistance & liberation'] },
    10: { 1: ['Origins of Cold War','Colonialism & independence'],  2: ['Civil rights movements'],  3: ['Independent Africa'],  4: ['End of apartheid'] },
    11: { 1: ['Communism in USSR','Rise of Nazism'],  2: ['World War II & Holocaust'],  3: ['Cold War crises'],  4: ['Independent Africa — challenges'] },
    12: { 1: ['Cold War — end','Germany re-unification'],  2: ['Civil society protests'],  3: ['Gender & race in SA history'],  4: ['Democratic SA'] },
  },
  geography: {
    7:  { 1: ['Map skills','Tectonic activity'],  2: ['Climate & weather'],  3: ['Rivers'],  4: ['Population'] },
    8:  { 1: ['Map skills','Africa — overview'],  2: ['Climate regions'],  3: ['Resources & industries'],  4: ['Settlement'] },
    9:  { 1: ['Map skills','Geomorphology'],  2: ['Atmosphere'],  3: ['Resources'],  4: ['Development'] },
    10: { 1: ['Geographical skills','The atmosphere'],  2: ['Geomorphology — rivers & drainage'],  3: ['Development geography'],  4: ['Population'] },
    11: { 1: ['Climate & weather','Atmosphere'],  2: ['Geomorphology — coasts'],  3: ['Economic geography'],  4: ['Settlement'] },
    12: { 1: ['Climate & weather systems','The lithosphere'],  2: ['Geomorphology','Oceans'],  3: ['Economic activities'],  4: ['Development & sustainability'] },
  },
};

// ── ATP Week Calculator ───────────────────────────────────────────────────────

/**
 * Returns the current SA school term, week within term, and overall school week.
 *
 * @param {Date} [date] - Date to check (defaults to today)
 * @returns {{ year, term, weekInTerm, schoolWeeksElapsed, totalWeeksInTerm, daysUntilTermEnd, isInTerm }}
 */
function getCurrentATPWeek(date = new Date()) {
  const year = date.getFullYear();
  const calendar = SA_SCHOOL_CALENDAR[year] || SA_SCHOOL_CALENDAR[2026]; // fallback

  let result = { year, term: null, weekInTerm: null, schoolWeeksElapsed: 0, totalWeeksInTerm: 0, daysUntilTermEnd: null, isInTerm: false };
  let cumWeeks = 0;

  for (let term = 1; term <= 4; term++) {
    const termData = calendar[term];
    const termStart = new Date(year, termData.start[0], termData.start[1]);
    const termEnd   = new Date(year, termData.end[0],   termData.end[1]);

    if (date >= termStart && date <= termEnd) {
      const msInTerm = date - termStart;
      const daysInTerm = Math.floor(msInTerm / (1000 * 60 * 60 * 24));
      const weekInTerm = Math.min(Math.floor(daysInTerm / 7) + 1, termData.weeks);
      const daysUntilEnd = Math.ceil((termEnd - date) / (1000 * 60 * 60 * 24));

      result = {
        year, term, weekInTerm,
        schoolWeeksElapsed: cumWeeks + weekInTerm,
        totalWeeksInTerm: termData.weeks,
        daysUntilTermEnd: daysUntilEnd,
        isInTerm: true,
      };
      break;
    }

    // Between terms
    const nextTermData = calendar[term + 1];
    if (term < 4 && nextTermData) {
      const nextStart = new Date(year, nextTermData.start[0], nextTermData.start[1]);
      if (date < nextStart) {
        result = {
          year, term, weekInTerm: termData.weeks,
          schoolWeeksElapsed: cumWeeks + termData.weeks,
          totalWeeksInTerm: termData.weeks,
          daysUntilTermEnd: null,
          isInTerm: false,
          schoolHoliday: true,
          nextTermStart: nextStart,
          nextTerm: term + 1,
        };
        break;
      }
    }

    cumWeeks += termData.weeks;
  }

  return result;
}

/**
 * Gets the expected topics for a given position in the year.
 *
 * @param {number} grade
 * @param {string} subject
 * @param {number} term
 * @param {number} weekInTerm - 1-based week number within the term
 * @returns {{ currentTopics: string[], completedTopics: string[], upcomingTopics: string[] }}
 */
function getTopicsForWeek(grade, subject, term, weekInTerm) {
  const key = subject.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z_]/g, '');
  const subjectData = CAPS_TOPICS[key];

  if (!subjectData || !subjectData[grade] || !subjectData[grade][term]) {
    return { currentTopics: [], completedTopics: [], upcomingTopics: [] };
  }

  const allTopics = subjectData[grade][term];
  const termTopicCount = allTopics.length;

  // Approximate: distribute topics evenly across the term weeks
  // Get term week count
  const termWeeks = Object.values(SA_SCHOOL_CALENDAR[2026][term] || SA_SCHOOL_CALENDAR[2026][1])[2] || 10;
  const topicsPerWeek = termTopicCount / termWeeks;

  const completedCount = Math.floor(topicsPerWeek * (weekInTerm - 1));
  const currentCount   = Math.max(1, Math.round(topicsPerWeek));
  const completedTopics = allTopics.slice(0, completedCount);
  const currentTopics   = allTopics.slice(completedCount, completedCount + currentCount);
  const upcomingTopics  = allTopics.slice(completedCount + currentCount);

  return { currentTopics, completedTopics, upcomingTopics };
}

/**
 * Gets the full list of expected topics for a term.
 */
function getTermTopics(grade, subject, term) {
  const key = subject.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z_]/g, '');
  return (CAPS_TOPICS[key] && CAPS_TOPICS[key][grade] && CAPS_TOPICS[key][grade][term]) || [];
}

/**
 * Resolves "the topic a teacher should be teaching right now" for a
 * grade/subject, using today's date and this service's ATP topic table —
 * the single source of truth for curriculum position. Used by
 * core/generationPipeline.js to fill in intent.topic when the teacher (or
 * the intent classifier) didn't provide one, instead of letting the AI
 * prompt free-associate a topic from general CAPS knowledge.
 *
 * @param {number} grade
 * @param {string} subject
 * @param {Date} [date]
 * @returns {{ topic: string, term: number, weekInTerm: number|null }|null}
 *   null if no ATP reference data exists for this grade/subject.
 */
function resolveCurrentTopic(grade, subject, date = new Date()) {
  const atpInfo = getCurrentATPWeek(date);
  const term = atpInfo.isInTerm ? atpInfo.term : (atpInfo.nextTerm || atpInfo.term);
  const weekInTerm = atpInfo.isInTerm ? atpInfo.weekInTerm : 1;

  const termTopics = getTermTopics(grade, subject, term);
  if (!termTopics.length) return null;

  const { currentTopics } = getTopicsForWeek(grade, subject, term, weekInTerm);
  const topic = (currentTopics[0] || termTopics[0]);

  return { topic, term, weekInTerm: atpInfo.isInTerm ? weekInTerm : null };
}

/**
 * Checks whether a teacher-provided topic string plausibly belongs to the
 * CURRENT term's ATP for a grade/subject. Deliberately loose (word-overlap,
 * not exact match) — teachers legitimately revisit earlier topics or work
 * ahead, so this is used to WARN, never to block generation.
 *
 * @param {number} grade
 * @param {string} subject
 * @param {string} topic
 * @param {Date} [date]
 * @returns {{ checked: boolean, matches: boolean, currentTermTopics: string[] }}
 *   checked: false if there's no ATP reference data to check against.
 */
function topicMatchesCurrentATP(grade, subject, topic, date = new Date()) {
  if (!topic) return { checked: false, matches: true, currentTermTopics: [] };

  const atpInfo = getCurrentATPWeek(date);
  const term = atpInfo.isInTerm ? atpInfo.term : (atpInfo.nextTerm || atpInfo.term);
  const termTopics = getTermTopics(grade, subject, term);

  if (!termTopics.length) return { checked: false, matches: true, currentTermTopics: [] };

  const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const matches = termTopics.some(t => {
    const tLower = t.toLowerCase();
    return tLower.includes(topic.toLowerCase()) ||
      topicWords.some(w => tLower.includes(w));
  });

  return { checked: true, matches, currentTermTopics: termTopics };
}

// ── Curriculum Query Handler ──────────────────────────────────────────────────

/**
 * Builds a natural-language curriculum intelligence response for a teacher query.
 *
 * @param {string} text - Raw teacher message
 * @param {Object} profile - Teacher profile { grade, subject, term }
 * @returns {string} Formatted WhatsApp message
 */
function handleCurriculumQuery(text, profile = {}) {
  const grade   = profile.grade != null ? parseInt(profile.grade, 10) : null;
  const subject = profile.subject || 'your subject';
  const atpInfo = getCurrentATPWeek();

  // If we don't have the teacher's grade/subject, give general info
  if (grade === null) {
    return buildGeneralATPStatus(atpInfo);
  }

  const term = atpInfo.isInTerm ? atpInfo.term : (atpInfo.nextTerm ? atpInfo.nextTerm - 1 : 4);
  const week = atpInfo.weekInTerm || (atpInfo.isInTerm ? atpInfo.totalWeeksInTerm : null);

  const termTopics   = getTermTopics(grade, subject, term);

  // No CAPS topic reference data exists for this grade/subject combination
  // (true for every grade below 7 today). Say so honestly instead of
  // dispatching to a report that would compute a fabricated "0% coverage".
  // Same signal/reasoning as curriculumCoverageService.js's `dataAvailable` flag.
  if (termTopics.length === 0) {
    return buildNoReferenceDataMessage({ grade, subject });
  }

  const weeksElapsed = atpInfo.isInTerm ? atpInfo.weekInTerm : atpInfo.totalWeeksInTerm;
  const totalWeeks   = atpInfo.totalWeeksInTerm || 10;
  const { currentTopics, completedTopics, upcomingTopics } = getTopicsForWeek(grade, subject, term, weeksElapsed);

  const coveragePct = termTopics.length
    ? Math.round((completedTopics.length / termTopics.length) * 100)
    : 0;

  const textLower = text.toLowerCase();

  // "Am I behind?" / "catch up" queries
  if (/behind|catch.?up|on track|pacing|pace/i.test(text)) {
    return buildPacingReport({ grade, subject, term, atpInfo, coveragePct, completedTopics, upcomingTopics, totalWeeks, weeksElapsed });
  }

  // "What topics this week?" / "what should I teach?"
  if (/this week|teach(ing)? now|current topic|next topic|what.*cover/i.test(text)) {
    return buildWeeklyTopics({ grade, subject, term, atpInfo, currentTopics, upcomingTopics, weeksElapsed, totalWeeks });
  }

  // "How much have I covered?" / "curriculum coverage" / "completed"
  if (/how much|coverage|completed|progress|done/i.test(text)) {
    return buildCoverageDashboard({ grade, subject, term, atpInfo, coveragePct, completedTopics, upcomingTopics });
  }

  // "What needs assessment?" / "formal assessment"
  if (/assess|test|exam|formal/i.test(text)) {
    return buildAssessmentReminder({ grade, subject, term, atpInfo, completedTopics });
  }

  // Default: general dashboard
  return buildCoverageDashboard({ grade, subject, term, atpInfo, coveragePct, completedTopics, upcomingTopics });
}

function buildNoReferenceDataMessage({ grade, subject }) {
  return (
    `📚 *${gradeLabel(grade)} ${subject}*\n\n` +
    `I don't have detailed CAPS topic reference data for this grade and subject yet, ` +
    `so I can't show pacing, weekly topics, or coverage percentages for it.\n\n` +
    `_I can still create worksheets, tests, lesson plans, and other CAPS-aligned materials for this grade — ` +
    `just no automatic curriculum-tracking dashboard for it yet._`
  );
}

function buildGeneralATPStatus(atpInfo) {
  if (!atpInfo.isInTerm) {
    const nextDate = atpInfo.nextTermStart
      ? atpInfo.nextTermStart.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' })
      : 'soon';
    return (
      `📅 *School Calendar Update*\n\n` +
      `You are currently on *Term ${atpInfo.term} holiday*.\n` +
      `Term ${atpInfo.nextTerm || atpInfo.term + 1} starts on *${nextDate}*.\n\n` +
      `_Set up your grade and subject profile so I can give you personalised ATP guidance. ` +
      `Reply with your grade and subject (e.g. "Grade 8 Mathematics") to get started._`
    );
  }
  return (
    `📅 *ATP Overview*\n\n` +
    `Currently *Term ${atpInfo.term}, Week ${atpInfo.weekInTerm}* of ${atpInfo.totalWeeksInTerm}.\n` +
    `${atpInfo.daysUntilTermEnd} days until end of term.\n\n` +
    `_Share your grade and subject so I can show your specific CAPS progress and ATP topics._`
  );
}

function buildPacingReport({ grade, subject, term, atpInfo, coveragePct, completedTopics, upcomingTopics, totalWeeks, weeksElapsed }) {
  const expectedPct = totalWeeks ? Math.round((weeksElapsed / totalWeeks) * 100) : 50;
  const gap = expectedPct - coveragePct;
  const riskLabel = gap > 20 ? '🔴 Behind Schedule' : gap > 5 ? '🟡 Slightly Behind' : '🟢 On Track';

  let msg = `📊 *Pacing Report — ${gradeLabel(grade)} ${subject}*\n`;
  msg += `Term ${term} | Week ${atpInfo.isInTerm ? atpInfo.weekInTerm : atpInfo.totalWeeksInTerm} of ${atpInfo.totalWeeksInTerm}\n\n`;
  msg += `*Status:* ${riskLabel}\n`;
  msg += `Expected coverage: ${expectedPct}% | Actual: ${coveragePct}%\n\n`;

  if (completedTopics.length) {
    msg += `✅ *Completed (${completedTopics.length} topics):*\n`;
    completedTopics.slice(-4).forEach(t => { msg += `  • ${t}\n`; });
    msg += '\n';
  }

  if (upcomingTopics.length) {
    msg += `📋 *Still to cover (${upcomingTopics.length} topics):*\n`;
    upcomingTopics.slice(0, 5).forEach(t => { msg += `  • ${t}\n`; });
    if (upcomingTopics.length > 5) msg += `  _...and ${upcomingTopics.length - 5} more_\n`;
    msg += '\n';
  }

  if (gap > 5) {
    const weeksLeft = totalWeeks - weeksElapsed;
    const topicsPerWeek = weeksLeft > 0 ? Math.ceil(upcomingTopics.length / weeksLeft) : upcomingTopics.length;
    msg += `💡 *Catch-up recommendation:*\n`;
    msg += `Cover approximately *${topicsPerWeek} topic${topicsPerWeek > 1 ? 's' : ''} per week* to complete the term syllabus.\n`;
    msg += `Focus on high-weight CAPS areas first.\n`;
  }

  return msg;
}

function buildWeeklyTopics({ grade, subject, term, atpInfo, currentTopics, upcomingTopics, weeksElapsed, totalWeeks }) {
  let msg = `📅 *This Week's ATP Topics — ${gradeLabel(grade)} ${subject}*\n`;
  msg += `Term ${term} | Week ${atpInfo.isInTerm ? atpInfo.weekInTerm : weeksElapsed} of ${totalWeeks}\n\n`;

  if (currentTopics.length) {
    msg += `*🎯 Focus this week:*\n`;
    currentTopics.forEach(t => { msg += `  • ${t}\n`; });
    msg += '\n';
  }

  if (upcomingTopics.length) {
    const next = upcomingTopics.slice(0, 3);
    msg += `*📋 Coming up next:*\n`;
    next.forEach(t => { msg += `  • ${t}\n`; });
    msg += '\n';
  }

  msg += `_Need a lesson plan, worksheet, or test on any of these topics? Just ask._`;
  return msg;
}

function buildCoverageDashboard({ grade, subject, term, atpInfo, coveragePct, completedTopics, upcomingTopics }) {
  let msg = `📊 *Curriculum Coverage — ${gradeLabel(grade)} ${subject}*\n`;
  msg += `Term ${term} | ${atpInfo.isInTerm ? `Week ${atpInfo.weekInTerm}` : 'End of term'}\n\n`;

  const bar = buildProgressBar(coveragePct);
  msg += `*Coverage: ${coveragePct}%* ${bar}\n\n`;

  if (completedTopics.length) {
    msg += `✅ *Completed (${completedTopics.length}):*\n`;
    completedTopics.forEach(t => { msg += `  ✓ ${t}\n`; });
    msg += '\n';
  }

  if (upcomingTopics.length) {
    msg += `📋 *Outstanding (${upcomingTopics.length}):*\n`;
    upcomingTopics.forEach(t => { msg += `  • ${t}\n`; });
    msg += '\n';
  }

  const riskLabel = coveragePct >= 85 ? '🟢 On Track' : coveragePct >= 65 ? '🟡 Monitor Closely' : '🔴 Needs Catch-up';
  msg += `*Risk Level:* ${riskLabel}\n`;

  return msg;
}

function buildAssessmentReminder({ grade, subject, term, atpInfo, completedTopics }) {
  let msg = `📝 *Assessment Planner — ${gradeLabel(grade)} ${subject}*\n`;
  msg += `Term ${term}\n\n`;

  if (completedTopics.length) {
    msg += `*Topics ready for formal assessment:*\n`;
    completedTopics.forEach(t => { msg += `  ✓ ${t}\n`; });
    msg += '\n';
  }

  msg += `💡 *Suggestions:*\n`;
  msg += `• Schedule a formal test before end of term\n`;
  msg += `• Include SBA tasks for portfolio evidence\n`;
  msg += `• Ensure all CAPS cognitive levels are covered\n\n`;
  msg += `_Reply "create a test" or "SBA task" to generate assessment materials._`;

  return msg;
}

function buildProgressBar(pct) {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getCurrentATPWeek,
  getTopicsForWeek,
  getTermTopics,
  handleCurriculumQuery,
  resolveCurrentTopic,
  topicMatchesCurrentATP,
  CAPS_TOPICS,
};
