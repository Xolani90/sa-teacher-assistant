'use strict';

/**
 * Observation-based assessment parser (Foundation Phase).
 *
 * Parses the WhatsApp-native observation format:
 *
 *   Assessment: Term 3 Week 4
 *   Grade: R
 *   Subject: Mathematics
 *
 *   Learner: Sipho
 *   Domain: Number Recognition
 *   Status: Developing
 *   Notes: Counts confidently to 10 but struggles beyond that.
 *
 *   Learner: Ayanda
 *   Domain: Oral Language
 *   Status: Achieved
 *   Notes: Speaks confidently in pairs.
 *
 *   Domain: Gross Motor
 *   Status: Not Yet
 *
 * Header fields (Assessment/Grade/Subject) are OPTIONAL at the parser
 * level — a teacher may already have selected these earlier in the
 * WhatsApp conversation flow. It's the calling workflow's job to decide
 * whether missing header context needs to be filled in or rejected.
 *
 * The parser operates in two phases, tracked explicitly by
 * `headerPhaseOpen`:
 *   1. Header phase — Assessment/Grade/Subject lines are accepted.
 *   2. Record phase — begins ONLY at the first valid "Learner:" line
 *      (a value-bearing learner line). Malformed lines (e.g. a stray
 *      "Domain:" before any learner) do not transition the parser —
 *      they're reported as errors without changing state, so a header
 *      line appearing afterward is still accepted.
 *
 * This NEVER produces mark / total_marks / percentage fields — output
 * represents developmental status only.
 *
 * See: docs/foundation-phase-observation-pipeline.md
 */

const VALID_STATUSES = ['Achieved', 'Developing', 'Not Yet'];

// Accepts common teacher variants: case, spacing, and "NotYet"/"Not yet".
// TODO: Phase 5 may externalize status labels for localization — if
// multi-language support is added, these labels should move out of the
// parser and into a language-aware config/lookup layer.
const STATUS_ALIASES = {
  achieved: 'Achieved',
  developing: 'Developing',
  'not yet': 'Not Yet',
  notyet: 'Not Yet',
};

const HEADER_KEYS = new Set(['assessment', 'grade', 'subject']);
const RECORD_KEYS = new Set(['learner', 'domain', 'status', 'notes']);
const VALID_KEYS = new Set([...HEADER_KEYS, ...RECORD_KEYS]);

const KEY_LINE_RE = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/;

// Matches ANY "something:" pattern, including keys KEY_LINE_RE rejects
// (hyphens, underscores, digits, etc.). Used to distinguish "malformed
// field name" from "genuine note text" in the continuation-line path,
// so a typo'd key like "Teacher-Name:" isn't silently swallowed into
// Notes.
const LOOKS_LIKE_KEY_RE = /^[^:]+:\s*/;

function normalizeStatus(raw) {
  return STATUS_ALIASES[raw.trim().toLowerCase()] || null;
}

function formatValidStatusList() {
  return 'Expected one of:\n' + VALID_STATUSES.map((s) => `  • ${s}`).join('\n');
}

function formatValidKeysList() {
  return (
    'Expected one of:\n' +
    ['Assessment', 'Grade', 'Subject', 'Learner', 'Domain', 'Status', 'Notes']
      .map((k) => `  • ${k}`)
      .join('\n')
  );
}

/**
 * Parses free-text teacher observation input into structured records.
 *
 * @param {string} input - Raw teacher-submitted observation text.
 * @returns {{
 *   success: boolean,
 *   header: { assessment: string|null, grade: string|null, subject: string|null },
 *   records: Array<{
 *     learnerName: string,
 *     domain: string,
 *     developmentalStatus: string,
 *     notes: string|null
 *   }>,
 *   metadata: {
 *     assessment: string|null,
 *     grade: string|null,
 *     subject: string|null,
 *     learnerCount: number,
 *     recordCount: number
 *   },
 *   errors: string[],
 *   warnings: string[]
 * }}
 */
function parseObservation(input) {
  const errors = [];
  const warnings = [];
  const records = [];
  const header = { assessment: null, grade: null, subject: null };

  if (!input || typeof input !== 'string' || !input.trim()) {
    return {
      success: false,
      header,
      records: [],
      metadata: { assessment: null, grade: null, subject: null, learnerCount: 0, recordCount: 0 },
      errors: ['Input is empty. Please submit an observation using the expected format.'],
      warnings: [],
    };
  }

  const lines = input.split(/\r\n|\r|\n/);

  // Two-phase state: true while header fields are still accepted.
  // Only closed by a VALID "Learner:" line — see case 'learner' below.
  let headerPhaseOpen = true;

  let currentLearner = null;
  let currentDomain = null;
  let currentStatus = null;
  let currentNotes = null;
  let currentDomainLine = null;

  const learnerNamesLower = new Set();

  function finalizeCurrentRecord(triggerLine) {
    if (currentDomain === null && currentStatus === null && currentNotes === null) {
      return; // nothing pending
    }
    if (!currentLearner) {
      errors.push(`Line ${currentDomainLine}: Domain given before any "Learner:" line.`);
    } else if (!currentDomain) {
      errors.push(`Line ${triggerLine}: Missing domain for learner "${currentLearner}".`);
    } else if (!currentStatus) {
      errors.push(`Line ${currentDomainLine}: Missing status for domain "${currentDomain}" (learner "${currentLearner}").`);
    } else {
      const notes =
        currentNotes && currentNotes.trim().length ? currentNotes.trim() : null;
      records.push({
        learnerName: currentLearner,
        domain: currentDomain,
        developmentalStatus: currentStatus,
        notes,
      });
    }
    currentDomain = null;
    currentStatus = null;
    currentNotes = null;
    currentDomainLine = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) continue;

    const match = line.match(KEY_LINE_RE);

    if (!match) {
      // Line contains a colon-prefixed token but didn't match a real key
      // (e.g. "Teacher-Name:", "Teacher_Name:") — likely a typo'd field
      // name, not genuine note text. Warn and skip rather than silently
      // absorbing it into Notes.
      if (LOOKS_LIKE_KEY_RE.test(line)) {
        warnings.push(
          `Line ${lineNum}: "${line}" looks like a field but isn't a recognized one ` +
          `(field names may only contain letters and spaces). It was ignored and not added to notes.`
        );
        continue;
      }
      // Continuation line: append to notes if we're inside a domain group.
      if (currentNotes !== null) {
        currentNotes += ' ' + line;
      } else if (currentDomain !== null) {
        // Text after Domain/Status but before a Notes: key — treat as notes.
        currentNotes = line;
      } else {
        warnings.push(`Line ${lineNum}: Unrecognized line ignored: "${line}"`);
      }
      continue;
    }

    const rawKey = match[1].trim();
    const key = rawKey.toLowerCase();
    const value = match[2].trim();

    if (!VALID_KEYS.has(key)) {
      warnings.push(`Line ${lineNum}: Unknown field "${rawKey}".\n${formatValidKeysList()}`);
      continue;
    }

    if (HEADER_KEYS.has(key)) {
      if (!headerPhaseOpen) {
        warnings.push(`Line ${lineNum}: "${rawKey}" appeared after learner records began and was ignored.`);
        continue;
      }
      if (!value) {
        warnings.push(`Line ${lineNum}: "${rawKey}:" has no value and was ignored.`);
      } else {
        // NOTE: If the same header key appears more than once while the
        // header phase is still open (e.g. two "Grade:" lines before the
        // first learner), the last value silently wins. This is treated
        // the same as a teacher correcting an earlier typo — no warning
        // is raised.
        header[key] = value;
      }
      continue;
    }

    switch (key) {
      case 'learner':
        finalizeCurrentRecord(lineNum);
        if (!value) {
          // Malformed learner line — does NOT close the header phase.
          errors.push(`Line ${lineNum}: Missing learner name.`);
          currentLearner = null;
        } else {
          // Only a legitimate, value-bearing learner line transitions
          // the parser from header mode into record mode.
          headerPhaseOpen = false;
          currentLearner = value;
          learnerNamesLower.add(value.trim().toLowerCase());
        }
        break;

      case 'domain':
        finalizeCurrentRecord(lineNum);
        if (!value) {
          errors.push(`Line ${lineNum}: Missing domain name.`);
        } else {
          currentDomain = value;
          currentDomainLine = lineNum;
        }
        break;

      case 'status': {
        if (!currentDomain) {
          errors.push(`Line ${lineNum}: "Status:" given with no preceding "Domain:" line.`);
          break;
        }
        const normalized = normalizeStatus(value);
        if (!normalized) {
          errors.push(
            `Line ${lineNum}: Unknown status "${value}". ${formatValidStatusList()}`
          );
        } else {
          currentStatus = normalized;
        }
        break;
      }

      case 'notes':
        // TODO (future UX): Consider warning when Notes: appears more
        // than once within the same learner/domain block. Currently the
        // last value silently wins (see regression test: "multiple
        // Notes: fields — last one wins"), which is fine for an
        // intentional correction but would silently discard a teacher's
        // first note if they meant to add a second one rather than
        // replace it. Revisit if this causes real confusion in practice.
        currentNotes = value;
        break;
    }
  }

  finalizeCurrentRecord(lines.length);

  if (learnerNamesLower.size === 0) {
    errors.push('No "Learner:" entries found. At least one learner observation is required.');
  }

  const metadata = {
    assessment: header.assessment,
    grade: header.grade,
    subject: header.subject,
    learnerCount: learnerNamesLower.size,
    recordCount: records.length,
  };

  return {
    success: errors.length === 0 && records.length > 0,
    header,
    records,
    metadata,
    errors,
    warnings,
  };
}

/**
 * Returns teacher-facing help text describing the expected observation
 * input format.
 *
 * @returns {string}
 */
function getObservationFormatHelpText() {
  return [
    'Please submit Foundation Phase observations in this format:',
    '',
    'Assessment: Term 3 Week 4',
    'Grade: R',
    'Subject: Mathematics',
    '',
    'Learner: Sipho',
    'Domain: Number Recognition',
    'Status: Developing',
    'Notes: Counts confidently to 10 but struggles beyond that.',
    '',
    'Learner: Ayanda',
    'Domain: Oral Language',
    'Status: Achieved',
    'Notes: Speaks confidently in pairs.',
    '',
    `Status must be one of: ${VALID_STATUSES.join(', ')}`,
    '(Also accepts common variants like "NotYet" or "not yet".)',
    'A learner can have more than one Domain/Status/Notes group.',
    'Assessment/Grade/Subject are optional if already known from context.',
  ].join('\n');
}

module.exports = {
  parseObservation,
  getObservationFormatHelpText,
};
