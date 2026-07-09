'use strict';

/**
 * Curriculum Intelligence Service
 * Understands the SA school calendar, ATP pacing, and curriculum coverage.
 * Powers Module 1 (Curriculum Intelligence Engine) of Part 3.
 */

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
  mathematics: {
    7: {
      1: ['Whole numbers','Exponents','Integers','Common fractions','Decimal fractions','Numeric patterns','Geometric patterns','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of 2D shapes','Geometry of 3D objects','Transformation geometry'],
      2: ['Whole numbers','Exponents','Integers','Common fractions','Decimal fractions','Numeric patterns','Geometric patterns','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of straight lines','Geometry of 2D shapes','Transformation geometry'],
      3: ['Whole numbers','Exponents','Integers','Common fractions','Decimal fractions','Numeric patterns','Geometric patterns','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of 2D shapes','Geometry of 3D objects','Transformation geometry','Probability'],
      4: ['Whole numbers','Exponents','Integers','Common fractions','Decimal fractions','Numeric patterns','Geometric patterns','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of 2D shapes','Geometry of 3D objects','Transformation geometry','Data handling'],
    },
    8: {
      1: ['Integers','Exponents','Numeric patterns','Geometric patterns','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of 2D shapes','Geometry of 3D objects','Transformation geometry','Geometry of straight lines'],
      2: ['Common fractions','Decimal fractions','Exponents','Numeric patterns','Geometric patterns','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of straight lines','Transformation geometry'],
      3: ['Integers','Common fractions','Decimal fractions','Exponents','Numeric patterns','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of 2D shapes','Geometry of 3D objects','Probability'],
      4: ['Integers','Common fractions','Decimal fractions','Exponents','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of 2D shapes','Geometry of 3D objects','Transformation geometry','Data handling'],
    },
    9: {
      1: ['Integers','Exponents','Numbers — scientific notation','Numeric patterns','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of 2D shapes','Transformation geometry'],
      2: ['Common fractions','Decimal fractions','Ratio & rate','Numbers — scientific notation','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of straight lines','Transformation geometry'],
      3: ['Integers','Rational numbers','Exponents','Numeric patterns','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of 2D shapes','Geometry of 3D objects','Probability'],
      4: ['Rational numbers','Exponents','Functions & relationships','Algebraic expressions','Algebraic equations','Geometry of 2D shapes','Geometry of 3D objects','Transformation geometry','Data handling'],
    },
    10: {
      1: ['Algebraic expressions','Exponents','Equations & inequalities','Euclidean geometry','Trigonometry','Functions'],
      2: ['Equations & inequalities','Trigonometry','Functions','Euclidean geometry','Analytical geometry','Finance & growth'],
      3: ['Functions','Finance & growth','Trigonometry','Euclidean geometry','Probability','Statistics'],
      4: ['Trigonometry','Euclidean geometry','Analytical geometry','Statistics','Probability'],
    },
    11: {
      1: ['Exponents & surds','Equations & inequalities','Number patterns','Functions','Trigonometry','Euclidean geometry'],
      2: ['Equations & inequalities','Functions','Finance, growth & decay','Trigonometry','Analytical geometry','Statistics'],
      3: ['Functions','Trigonometry','Finance, growth & decay','Euclidean geometry','Probability','Statistics'],
      4: ['Trigonometry','Euclidean geometry','Analytical geometry','Statistics','Probability'],
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

// ── Curriculum Query Handler ──────────────────────────────────────────────────

/**
 * Builds a natural-language curriculum intelligence response for a teacher query.
 *
 * @param {string} text - Raw teacher message
 * @param {Object} profile - Teacher profile { grade, subject, term }
 * @returns {string} Formatted WhatsApp message
 */
function handleCurriculumQuery(text, profile = {}) {
  const grade   = parseInt(profile.grade) || null;
  const subject = profile.subject || 'your subject';
  const atpInfo = getCurrentATPWeek();

  // If we don't have the teacher's grade/subject, give general info
  if (!grade) {
    return buildGeneralATPStatus(atpInfo);
  }

  const term = atpInfo.isInTerm ? atpInfo.term : (atpInfo.nextTerm ? atpInfo.nextTerm - 1 : 4);
  const week = atpInfo.weekInTerm || (atpInfo.isInTerm ? atpInfo.totalWeeksInTerm : null);

  const termTopics   = getTermTopics(grade, subject, term);
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

  let msg = `📊 *Pacing Report — Grade ${grade} ${subject}*\n`;
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
  let msg = `📅 *This Week's ATP Topics — Grade ${grade} ${subject}*\n`;
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
  let msg = `📊 *Curriculum Coverage — Grade ${grade} ${subject}*\n`;
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
  let msg = `📝 *Assessment Planner — Grade ${grade} ${subject}*\n`;
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
  CAPS_TOPICS,
};
