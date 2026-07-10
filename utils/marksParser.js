'use strict';

/**
 * marksParser.js
 *
 * Parses teacher-submitted assessment marks from two input formats:
 *
 * ── TEXT FORMAT (inline WhatsApp message, one learner per line) ─────────────
 *
 *   Thabo 18/30 Q1:5/5 Q2:3/5 Q3:6/10 Q4:4/10
 *   Sipho 22/30 Q1:5/5 Q2:4/5 Q3:8/10 Q4:5/10
 *
 *   Rules:
 *   - Name is the first token (may be multiple words if followed by a number pattern)
 *   - Overall mark format: total/max (e.g. 18/30) — optional if per-question marks given
 *   - Per-question format: Q<n>:<mark>/<max> — optional but required for item analysis
 *   - Lines starting with # are ignored (comments / instructions)
 *   - Empty lines are ignored
 *
 * ── CSV FORMAT (uploaded document) ─────────────────────────────────────────
 *
 *   Name,Total,Q1,Q2,Q3,Q4
 *   Topics,,fractions,fractions,algebraic equations,geometry
 *   Thabo,18,5,3,6,4
 *   Sipho,22,5,4,8,5
 *
 *   Rules:
 *   - First row must be the header: Name, then Total (optional), then Q1..Qn
 *   - Second row may be "Topics" (case-insensitive first cell) — per-question CAPS topics
 *   - Max marks per question must be supplied separately (totalMark / numQuestions
 *     is used as a fallback if per-question maxes aren't in the header)
 *   - Extended header format with maxmarks: Name,Total/30,Q1/5,Q2/5,Q3/10,Q4/10
 *     → per-question max marks parsed from the header itself
 *
 * ── OUTPUT SHAPE ────────────────────────────────────────────────────────────
 *
 *   {
 *     totalMark: 30,            // max possible marks for the assessment
 *     questionCount: 4,
 *     questionMaxMarks: { '1': 5, '2': 5, '3': 10, '4': 10 },
 *     questionTopics: { '1': 'fractions', '3': 'algebraic equations' },  // optional
 *     learners: [
 *       {
 *         learnerName: 'Thabo',
 *         mark: 18,
 *         totalMarks: 30,
 *         questionData: {
 *           '1': { mark: 5, maxMark: 5, topic: 'fractions' },
 *           '2': { mark: 3, maxMark: 5, topic: 'fractions' },
 *           '3': { mark: 6, maxMark: 10, topic: 'algebraic equations' },
 *           '4': { mark: 4, maxMark: 10, topic: 'geometry' },
 *         }
 *       },
 *       ...
 *     ],
 *     warnings: [],   // non-fatal issues (e.g. mark > total for one learner)
 *     errors: [],     // fatal issues (returned instead of learners if non-empty)
 *   }
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Splits a CSV line respecting double-quoted fields with embedded commas.
 * Does not support multi-line quoted fields (WhatsApp messages won't have those).
 */
function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parses a "value/max" token (e.g. "18/30", "5/5").
 * Returns { value, max } or null if the token doesn't match.
 */
function parseSlashPair(token) {
  const m = token.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { value: parseFloat(m[1]), max: parseFloat(m[2]) };
}

// ── Text format parser ───────────────────────────────────────────────────────

/**
 * Parses inline text format (one learner per line).
 *
 * @param {string} text
 * @returns {{ learners, totalMark, questionCount, questionMaxMarks, questionTopics, warnings, errors }}
 */
function parseTextFormat(text) {
  const warnings = [];
  const errors = [];
  const learners = [];
  const questionMaxMarks = {};
  const questionTopics = {};

  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  if (lines.length === 0) {
    errors.push('No learner data found. Please check your format and try again.');
    return { learners, totalMark: 0, questionCount: 0, questionMaxMarks, questionTopics, warnings, errors };
  }

  for (const line of lines) {
    // Extract Q<n>:<mark>/<max> tokens first
    const qPattern = /Q(\d+):(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/gi;
    const questionData = {};
    let qMatch;
    // eslint-disable-next-line no-cond-assign
    while ((qMatch = qPattern.exec(line)) !== null) {
      const qNum = qMatch[1];
      const mark = parseFloat(qMatch[2]);
      const maxMark = parseFloat(qMatch[3]);
      questionData[qNum] = { mark, maxMark };
      // Track the max marks seen across learners per question
      if (!questionMaxMarks[qNum] || questionMaxMarks[qNum] < maxMark) {
        questionMaxMarks[qNum] = maxMark;
      }
    }

    // Remove Q<n>:<mark>/<max> tokens to isolate name + overall mark
    const stripped = line.replace(/Q\d+:\d+(?:\.\d+)?\/\d+(?:\.\d+)?/gi, '').trim();

    // Find overall mark token (first "number/number" pattern)
    const overallMatch = stripped.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/);
    let overallMark = null;
    let overallMax = null;
    let nameSource = stripped;
    if (overallMatch) {
      overallMark = parseFloat(overallMatch[1]);
      overallMax = parseFloat(overallMatch[2]);
      nameSource = stripped.slice(0, overallMatch.index).trim();
    }

    // Name is everything before the overall mark token
    const learnerName = nameSource.replace(/\s+/g, ' ').trim();
    if (!learnerName) {
      warnings.push(`Skipped a line — could not find a learner name: "${line}"`);
      continue;
    }

    // Derive overall mark from question totals if not explicitly given
    let mark = overallMark;
    let totalMarks = overallMax;

    if (mark === null && Object.keys(questionData).length > 0) {
      mark = Object.values(questionData).reduce((sum, q) => sum + q.mark, 0);
      totalMarks = Object.values(questionData).reduce((sum, q) => sum + q.maxMark, 0);
    }

    if (mark === null) {
      warnings.push(`Skipped "${learnerName}" — no marks found on this line.`);
      continue;
    }

    if (mark > totalMarks) {
      warnings.push(`"${learnerName}" has mark ${mark} which exceeds total ${totalMarks}. Check the data.`);
    }

    learners.push({ learnerName, mark, totalMarks, questionData });
  }

  if (learners.length === 0) {
    errors.push('No valid learner records were parsed. Please check your format.');
  }

  const totalMark = learners.length > 0 ? (learners[0].totalMarks || 0) : 0;
  const questionCount = Object.keys(questionMaxMarks).length;

  return { learners, totalMark, questionCount, questionMaxMarks, questionTopics, warnings, errors };
}

// ── CSV format parser ────────────────────────────────────────────────────────

/**
 * Parses CSV buffer (from a WhatsApp document upload).
 *
 * @param {Buffer|string} csvInput
 * @returns {{ learners, totalMark, questionCount, questionMaxMarks, questionTopics, warnings, errors }}
 */
function parseCsvFormat(csvInput) {
  const warnings = [];
  const errors = [];
  const learners = [];
  const questionMaxMarks = {};
  const questionTopics = {};

  const text = Buffer.isBuffer(csvInput) ? csvInput.toString('utf8') : csvInput;
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);

  if (rawLines.length < 2) {
    errors.push('CSV must have at least a header row and one learner row.');
    return { learners, totalMark: 0, questionCount: 0, questionMaxMarks, questionTopics, warnings, errors };
  }

  // ── Parse header row ──
  const headerFields = splitCsvLine(rawLines[0]);
  const headerLower = headerFields.map(h => h.toLowerCase());

  if (!headerLower[0].startsWith('name')) {
    errors.push('CSV header must start with "Name" in the first column.');
    return { learners, totalMark: 0, questionCount: 0, questionMaxMarks, questionTopics, warnings, errors };
  }

  // Parse "Total/30" or "Q1/5" style max marks from header cells
  let overallMaxFromHeader = null;
  const questionCols = []; // [{ colIndex, qNum, maxMark }]

  for (let i = 1; i < headerFields.length; i++) {
    const header = headerFields[i];

    // Extract optional "/max" suffix from a header label, e.g. "Total/30" → max=30, "Q1/5" → max=5
    // The label may be "Total", "Q1", "Q2" etc., optionally followed by /number
    const headerMaxMatch = header.match(/\/(\d+(?:\.\d+)?)$/);
    const headerMax = headerMaxMatch ? parseFloat(headerMaxMatch[1]) : null;

    // Is this a Total column?
    if (/^total/i.test(header)) {
      if (headerMax !== null) overallMaxFromHeader = headerMax;
      questionCols.push({ colIndex: i, type: 'total', maxMark: headerMax });
      continue;
    }

    // Is this a Q<n> column?
    const qMatch = header.match(/^Q(\d+)/i);
    if (qMatch) {
      const qNum = qMatch[1];
      if (headerMax !== null) questionMaxMarks[qNum] = headerMax;
      questionCols.push({ colIndex: i, type: 'question', qNum, maxMark: headerMax });
    }
  }

  const questionOnlyCols = questionCols.filter(c => c.type === 'question');

  if (questionOnlyCols.length === 0 && !questionCols.some(c => c.type === 'total')) {
    errors.push('CSV must have at least a Total or Q1, Q2... column after Name.');
    return { learners, totalMark: 0, questionCount: 0, questionMaxMarks, questionTopics, warnings, errors };
  }

  // ── Check for optional Topics row ──
  let dataStartRow = 1;
  const secondRowFields = splitCsvLine(rawLines[1]);
  if (/^topics?$/i.test(secondRowFields[0])) {
    // Parse topics for each question column
    for (const col of questionOnlyCols) {
      const topicVal = secondRowFields[col.colIndex] || '';
      if (topicVal) questionTopics[col.qNum] = topicVal.trim();
    }
    dataStartRow = 2;
  }

  // ── Parse learner rows ──
  // Determine overall max: prefer header annotation, else sum of question maxes, else defer to first data row
  let inferredOverallMax = overallMaxFromHeader;
  if (!inferredOverallMax && Object.keys(questionMaxMarks).length > 0) {
    inferredOverallMax = Object.values(questionMaxMarks).reduce((s, v) => s + v, 0);
  }

  for (let rowIdx = dataStartRow; rowIdx < rawLines.length; rowIdx++) {
    const fields = splitCsvLine(rawLines[rowIdx]);
    const learnerName = fields[0] || '';
    if (!learnerName) continue;

    let overallMark = null;
    let overallMax = inferredOverallMax;
    const questionData = {};

    for (const col of questionCols) {
      const rawVal = fields[col.colIndex] || '';
      // Support "mark/max" in individual cells too (overrides header max)
      const slashPair = parseSlashPair(rawVal);
      const cellMark = slashPair ? slashPair.value : (rawVal === '' ? null : parseFloat(rawVal));

      if (col.type === 'total') {
        if (cellMark !== null && !isNaN(cellMark)) {
          overallMark = cellMark;
          if (slashPair) overallMax = slashPair.max;
        }
      } else {
        // question column
        if (cellMark !== null && !isNaN(cellMark)) {
          const maxMark = slashPair ? slashPair.max : (questionMaxMarks[col.qNum] || null);
          if (maxMark === null) {
            warnings.push(`No max mark known for Q${col.qNum} — set it in the header (e.g. Q${col.qNum}/10).`);
          }
          questionData[col.qNum] = {
            mark: cellMark,
            maxMark: maxMark || 0,
            ...(questionTopics[col.qNum] ? { topic: questionTopics[col.qNum] } : {}),
          };
        }
      }
    }

    // Derive overall from questions if not given
    if (overallMark === null && Object.keys(questionData).length > 0) {
      overallMark = Object.values(questionData).reduce((s, q) => s + q.mark, 0);
    }
    if (!overallMax && Object.keys(questionData).length > 0) {
      overallMax = Object.values(questionData).reduce((s, q) => s + (q.maxMark || 0), 0);
    }

    if (overallMark === null || isNaN(overallMark)) {
      warnings.push(`Skipped "${learnerName}" — no valid mark found.`);
      continue;
    }

    if (overallMark > overallMax) {
      warnings.push(`"${learnerName}" has mark ${overallMark} which exceeds total ${overallMax}. Check the data.`);
    }

    // Update global question max marks from any per-cell overrides
    for (const [qNum, qd] of Object.entries(questionData)) {
      if (qd.maxMark && (!questionMaxMarks[qNum] || questionMaxMarks[qNum] < qd.maxMark)) {
        questionMaxMarks[qNum] = qd.maxMark;
      }
    }

    learners.push({ learnerName, mark: overallMark, totalMarks: overallMax, questionData });
  }

  if (learners.length === 0) {
    errors.push('No valid learner rows found in the CSV.');
  }

  const totalMark = inferredOverallMax || (learners.length > 0 ? learners[0].totalMarks : 0) || 0;
  const questionCount = questionOnlyCols.length;

  return { learners, totalMark, questionCount, questionMaxMarks, questionTopics, warnings, errors };
}

// ── Excel format parser ──────────────────────────────────────────────────────

/**
 * Parses an Excel (.xlsx / .xls) buffer into the same shape as parseCsvFormat.
 * Uses the SheetJS (xlsx) library — sheets are read as CSV and handed off to
 * parseCsvFormat so all downstream logic stays in one place.
 *
 * @param {Buffer} xlsxBuffer
 * @returns {{ learners, totalMark, questionCount, questionMaxMarks, questionTopics, warnings, errors }}
 */
function parseXlsxFormat(xlsxBuffer) {
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch {
    return {
      learners: [], totalMark: 0, questionCount: 0,
      questionMaxMarks: {}, questionTopics: {},
      warnings: [],
      errors: ['Excel parsing is not available — the xlsx library is not installed. Please upload a CSV file instead.'],
    };
  }

  try {
    const workbook = XLSX.read(xlsxBuffer, { type: 'buffer' });
    // Use the first sheet
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return {
        learners: [], totalMark: 0, questionCount: 0,
        questionMaxMarks: {}, questionTopics: {},
        warnings: [],
        errors: ['The Excel file appears to be empty or has no sheets.'],
      };
    }
    const sheet = workbook.Sheets[sheetName];
    // Convert to CSV so we can reuse parseCsvFormat exactly
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const result = parseCsvFormat(csv);
    // Note the source
    if (result.warnings.length === 0 && result.errors.length === 0) {
      result.warnings.push(`Imported from Excel sheet: "${sheetName}"`);
    }
    return result;
  } catch (err) {
    return {
      learners: [], totalMark: 0, questionCount: 0,
      questionMaxMarks: {}, questionTopics: {},
      warnings: [],
      errors: [`Could not read the Excel file: ${err.message}. Please try saving as .csv and uploading that instead.`],
    };
  }
}

// ── Image mark sheet extraction ──────────────────────────────────────────────

const IMAGE_MARKS_PROMPT = `You are reading a photo or scan of a teacher's mark sheet. Extract the data and output ONLY a valid CSV — no extra text, no explanation, just the CSV rows.

The CSV format must be:
Name,Total/[max],[Q1/[max]],[Q2/[max]],... 

Rules:
- First row is the header: Name, then Total with max in format Total/30, then any question columns in format Q1/5, Q2/10, etc.
- If you cannot see individual question columns, only output Name and Total/[max].
- If you cannot determine the maximum mark, use the highest mark you can see as the max.
- One learner per row after the header.
- Names exactly as written on the sheet.
- If a mark is absent/blank, leave the cell empty.
- Output ONLY the CSV. Do not add any preamble, notes, or explanation.

Example output:
Name,Total/50,Q1/10,Q2/15,Q3/25
Thabo,38,8,12,18
Sipho,45,10,14,21`;

/**
 * Extracts marks from an image (photo/scan of a mark sheet) using AI vision.
 * Returns the same shape as parseMarks.
 *
 * This is async — callers must await it.
 *
 * @param {Buffer} imageBuffer
 * @param {string} mimeType - e.g. 'image/jpeg', 'image/png', 'image/webp'
 * @returns {Promise<{ learners, totalMark, questionCount, questionMaxMarks, questionTopics, warnings, errors }>}
 */
async function extractMarksFromImage(imageBuffer, mimeType) {
  const { generateWithVision } = require('../services/aiService');
  let csvText;
  try {
    csvText = (await generateWithVision(imageBuffer, mimeType, IMAGE_MARKS_PROMPT)).trim();
  } catch (err) {
    return {
      learners: [], totalMark: 0, questionCount: 0,
      questionMaxMarks: {}, questionTopics: {},
      warnings: [],
      errors: [`Could not read the mark sheet image: ${err.message}. Please try uploading a CSV file instead.`],
    };
  }

  // Strip any accidental markdown fences the model may have added
  csvText = csvText.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

  if (!csvText) {
    return {
      learners: [], totalMark: 0, questionCount: 0,
      questionMaxMarks: {}, questionTopics: {},
      warnings: [],
      errors: ['Could not extract any marks from the image. Please check the photo quality or upload a CSV file.'],
    };
  }

  const result = parseCsvFormat(csvText);
  // Tag the result so the caller knows it came from vision
  result._source = 'image';
  if (result.errors.length === 0) {
    result.warnings.unshift('📸 Marks extracted from your image. Please verify the data below is correct before proceeding.');
  }
  return result;
}

// ── Auto-detect and dispatch ─────────────────────────────────────────────────

/**
 * Parses marks from either a CSV buffer, Excel buffer, or inline text.
 * Auto-detects format based on input type and content.
 *
 * @param {Buffer|string} input   - CSV/XLSX buffer or text string
 * @param {'text'|'csv'|'xlsx'|'auto'}  [format='auto']
 * @returns {{ learners, totalMark, questionCount, questionMaxMarks, questionTopics, warnings, errors }}
 */
function parseMarks(input, format = 'auto') {
  let result;

  if (format === 'xlsx') {
    result = parseXlsxFormat(input);
  } else if (format === 'csv' || (format === 'auto' && Buffer.isBuffer(input))) {
    // Buffer that isn't explicitly xlsx — check magic bytes for Excel signature
    if (Buffer.isBuffer(input) && input.length >= 4) {
      // XLSX/ZIP magic: PK\x03\x04 (50 4B 03 04)
      // XLS/CFB magic: D0 CF 11 E0
      const isXlsx = input[0] === 0x50 && input[1] === 0x4B && input[2] === 0x03 && input[3] === 0x04;
      const isXls  = input[0] === 0xD0 && input[1] === 0xCF && input[2] === 0x11 && input[3] === 0xE0;
      result = (isXlsx || isXls) ? parseXlsxFormat(input) : parseCsvFormat(input);
    } else {
      result = parseCsvFormat(input);
    }
  } else {
    const text = typeof input === 'string' ? input : input.toString('utf8');
    if (format === 'auto') {
      // Heuristic: if the first non-empty line looks like CSV headers (Name,Total or Name,Q1)
      const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
      const looksLikeCsv = /^name\s*,/i.test(firstLine);
      result = looksLikeCsv ? parseCsvFormat(text) : parseTextFormat(text);
    } else {
      result = parseTextFormat(text);
    }
  }

  // Warn on duplicate learner names — common in SA classrooms (multiple
  // learners sharing a first name) and otherwise silent: two "Thabo" rows
  // would be stored as indistinguishable entries, and a report showing
  // "Thabo: Group A" / "Thabo: Group C" gives the teacher no way to tell
  // which physical learner is which. We can't fix the ambiguity itself
  // (there's no learner ID in this input format), but the teacher should
  // at least be told so they can resubmit with surnames/initials.
  if (result && Array.isArray(result.learners) && result.learners.length > 0) {
    const nameCounts = {};
    for (const learner of result.learners) {
      const key = (learner.learnerName || '').trim().toLowerCase();
      if (!key) continue;
      nameCounts[key] = (nameCounts[key] || 0) + 1;
    }
    const duplicates = Object.entries(nameCounts).filter(([, count]) => count > 1).map(([name]) => name);
    if (duplicates.length > 0) {
      result.warnings.push(
        `Duplicate learner name(s) found: ${duplicates.join(', ')}. Reports won't be able to tell these learners apart — consider resubmitting with a surname or initial (e.g. "Thabo M").`
      );
    }
  }

  return result;
}

/**
 * Returns a template string explaining the accepted input formats.
 * Used by the webhook flow when a teacher first triggers data assessment.
 */
function getFormatHelpText() {
  return [
    '📋 *How to submit marks*',
    '',
    '*Option 1 — Type marks directly:*',
    'One learner per line: Name Overall Q1:mark/max Q2:mark/max ...',
    '',
    'Example:',
    'Thabo 18/30 Q1:5/5 Q2:3/5 Q3:6/10 Q4:4/10',
    'Sipho 22/30 Q1:5/5 Q2:4/5 Q3:8/10 Q4:5/10',
    '',
    '*Option 2 — Upload a CSV file (.csv):*',
    'Header row: Name,Total/30,Q1/5,Q2/5,Q3/10,Q4/10',
    'Optional 2nd row: Topics,,fractions,fractions,algebra,geometry',
    'Then one row per learner.',
    '',
    '*Option 3 — Upload an Excel file (.xlsx):*',
    'Same layout as CSV — first column Name, then Total, then Q1, Q2...',
    '',
    '*Option 4 — Send a photo of your mark sheet:*',
    'Take a clear, well-lit photo of your printed mark sheet and send it here.',
    'I\'ll read the names and marks automatically. ✨',
    '',
    '💡 Include per-question marks (Q1, Q2...) for full item and error analysis.',
  ].join('\n');
}

module.exports = {
  parseMarks,
  parseTextFormat,
  parseCsvFormat,
  parseXlsxFormat,
  extractMarksFromImage,
  getFormatHelpText,
};
