'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { buildAtoms, layoutAtoms } = require('./mathTypeset/richtext');

// PDFs are stored in /tmp and served via the /pdf/:id route
// They are auto-cleaned after 1 hour via the cleanup scheduler
// PDFs are stored alongside the database so they land on the same
// persistent disk on Render. If DB_PATH is set (e.g. /var/data/teacher_assistant.db)
// PDFs go to /var/data/pdfs/. If not set, defaults to ./data/pdfs.
const _DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'teacher_assistant.db');
const PDF_DIR  = path.join(path.dirname(_DB_PATH), 'pdfs');

/**
 * Ensures the PDF output directory exists.
 */
function ensurePdfDir() {
  if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
  }
}

// ── Color palette (CAPS-aligned, school-appropriate) ──────────────────────
const COLORS = {
  primary:    '#1a3c5e', // Deep navy — professional, trustworthy
  accent:     '#2e7d32', // Forest green — education, growth
  lightGray:  '#f5f5f5',
  midGray:    '#9e9e9e',
  darkText:   '#212121',
  white:      '#ffffff',
  border:     '#e0e0e0',
};

const FONTS = {
  heading:  'Helvetica-Bold',
  body:     'Helvetica',
  italic:   'Helvetica-Oblique',
  mono:     'Courier',
};

// ── Text sanitisation (root-cause fix for garbled PDF output) ─────────────
//
// PDFKit's built-in "standard 14" fonts (Helvetica, Helvetica-Bold, etc.)
// only support the WinAnsi single-byte character set. Any character outside
// that range — Unicode fraction glyphs (½ ⅓ ⅔ ⅛), superscript digits (² ³),
// the radical sign (√), checkmarks (✓), emoji, smart quotes/dashes, and
// typographic bullets (•) — silently renders as garbage glyphs from
// whatever byte happens to collide in the font's internal encoding table.
// This is the actual cause of artefacts like "!T", "u D †", "%P%P%P",
// and "Ø=Üª" showing up in generated PDFs: the AI model (correctly) writes
// proper Unicode maths notation, and PDFKit mangles it on render.
//
// Rather than embedding a full Unicode TTF (adds binary assets + licensing
// overhead), we normalise text to WinAnsi-safe equivalents immediately
// before it reaches PDFKit. This is applied globally via a wrapper around
// doc.text() so every call site is covered without having to audit each one.
const UNICODE_SANITISE_MAP = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4',
  '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
  '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
  '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4', '⁵': '^5',
  '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9',
  // U+2212 (true mathematical minus sign) is distinct from the ASCII hyphen
  // and from the en/em dashes below — it was previously MISSING from this
  // map entirely, so it fell through to the blanket [^\x00-\xFF] strip and
  // was silently deleted, producing "5/6 1/3" instead of "5/6 - 1/3".
  '−': '-',
  '√': 'sqrt', '×': 'x', '÷': '/', '≈': '~=', '≠': '!=', '≤': '<=', '≥': '>=',
  // Marking-memo ticks/crosses: previously ✓/✔ were mapped to a bare "'"
  // character, which reads as a stray apostrophe in running text (e.g.
  // "Proper fraction ' (1)"). Marks are already conveyed by the trailing
  // "(1)"/"(2)" allocation, so the tick itself is decorative — dropping it
  // is clearer than rendering a misleading punctuation mark. Crosses stay
  // as a plain "X" since that's an unambiguous, meaningful substitution.
  '✓': '', '✔': '', '✗': 'X', '✘': 'X',
  '•': '-', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...',
  // Fallback entries: if convertUnicodeFractions() below doesn't catch a
  // fraction sequence (e.g. malformed input, or a lone subscript digit with
  // no matching superscript/slash), these prevent silent deletion. Without
  // them, the blanket [^\x00-\xFF] strip at the end of sanitiseForPdf()
  // would just delete these characters outright — which is the root cause
  // of denominators vanishing (e.g. "¹²⁄₁₈" -> "^1^2^1^8" with "18" gone).
  '⁄': '/',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

// Unicode superscript/subscript digit -> plain digit lookup tables, used by
// convertUnicodeFractions() to reconstruct whole fraction sequences.
const SUPERSCRIPT_DIGITS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
const SUBSCRIPT_DIGITS   = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const SUPER_CHARS = Object.keys(SUPERSCRIPT_DIGITS).join('');
const SUB_CHARS   = Object.keys(SUBSCRIPT_DIGITS).join('');

// Matches an optional whole-number lead-in (no space, e.g. the "2" in
// "2³⁄₄") directly followed by a superscript numerator, the Unicode
// fraction slash (U+2044), and a denominator in either subscript or plain
// ASCII digits (the AI model isn't perfectly consistent about which it
// emits for the denominator, so both are accepted).
const UNICODE_FRACTION_RE = new RegExp(`(\\d+)?([${SUPER_CHARS}]+)\u2044([${SUB_CHARS}0-9]+)`, 'g');

/**
 * Converts whole Unicode fraction sequences (e.g. "¹²⁄₁₈", "2³⁄₄") into
 * plain-ASCII form ("12/18", "2 3/4") BEFORE the character-by-character
 * UNICODE_SANITISE_MAP runs.
 *
 * This matters because that per-character map treats every superscript
 * digit as a standalone exponent (² -> "^2"), which is correct for a real
 * exponent like "5²" but wrong for a fraction numerator: "¹²⁄₁₈" would
 * otherwise become "^1^2^1^8" with the fraction slash and denominator
 * silently deleted by the blanket [^\x00-\xFF] strip — real data loss on a
 * maths paper, not just a cosmetic glitch. Running this first means a
 * genuine standalone exponent (no fraction slash following it) is left
 * alone and still gets the correct "^N" treatment afterward.
 */
function convertUnicodeFractions(input) {
  return input.replace(UNICODE_FRACTION_RE, (match, whole, superNum, denom) => {
    const num = superNum.split('').map((c) => SUPERSCRIPT_DIGITS[c] || c).join('');
    const den = denom.split('').map((c) => SUBSCRIPT_DIGITS[c] || c).join('');
    return whole ? `${whole} ${num}/${den}` : `${num}/${den}`;
  });
}

// Matches \frac{a}{b}, \dfrac{a}{b}, or \tfrac{a}{b}, with an optional
// whole-number lead-in directly before it for mixed numbers (e.g. the "3"
// in "3\frac{2}{7}"). PDFKit has no LaTeX renderer, so unconverted LaTeX
// prints as literal backslashes and braces in the PDF — this is a separate
// failure mode from the Unicode fraction glyphs handled above, seen when
// the AI model emits maths as LaTeX instead (e.g. "$\frac{5}{8}$" printing
// verbatim rather than as "5/8"). Numerator/denominator are kept generic
// (not digit-only) since they occasionally contain a nested expression
// rather than a bare number.
const LATEX_FRAC_RE = /(\d+)?\\(?:d|t)?frac\{([^{}]*)\}\{([^{}]*)\}/g;

// Other common LaTeX maths commands that show up in AI-generated content.
// Order matters: \sqrt{...} needs its own regex (has braced content), the
// rest are simple string substitutions.
const LATEX_SQRT_RE = /\\sqrt\{([^{}]*)\}/g;
const LATEX_COMMAND_MAP = {
  '\\times': 'x', '\\cdot': 'x', '\\div': '/',
  '\\pm': '+/-', '\\mp': '-/+',
  '\\le': '<=', '\\leq': '<=', '\\ge': '>=', '\\geq': '>=', '\\neq': '!=',
  '\\left(': '(', '\\right)': ')', '\\left[': '[', '\\right]': ']',
  '\\left|': '|', '\\right|': '|',
  '\\%': '%', '\\ ': ' ',
  // \(...\) and \[...\] are the other common LaTeX inline/display math
  // delimiter styles (besides $...$, already handled below) — same failure
  // mode: the content between them gets converted above, but without this
  // the bare delimiter markers themselves print literally in the PDF
  // (e.g. "\( 5/8 \)" instead of just "5/8").
  '\\(': '', '\\)': '', '\\[': '', '\\]': '',
};

/**
 * Converts LaTeX maths markup to plain ASCII, mirroring what
 * convertUnicodeFractions() does for Unicode fraction glyphs. Runs before
 * the per-character UNICODE_SANITISE_MAP so the "$" delimiters and stray
 * backslashes/braces don't fall through to the blanket [^\x00-\xFF]-style
 * cleanup and get silently mangled.
 */
function convertLatexMath(input) {
  let out = input.replace(LATEX_FRAC_RE, (match, whole, num, den) => (
    whole ? `${whole} ${num}/${den}` : `${num}/${den}`
  ));
  out = out.replace(LATEX_SQRT_RE, 'sqrt($1)');
  for (const [bad, good] of Object.entries(LATEX_COMMAND_MAP)) {
    if (out.indexOf(bad) !== -1) out = out.split(bad).join(good);
  }
  // Inline/display math delimiters ($...$ or $$...$$) — the content in
  // between has already been converted above, so the delimiters themselves
  // are just stripped rather than rendered as literal dollar signs.
  out = out.replace(/\$/g, '');
  return out;
}

function sanitiseForPdf(input) {
  if (typeof input !== 'string') return input;
  let out = convertLatexMath(input);
  out = convertUnicodeFractions(out);
  for (const [bad, good] of Object.entries(UNICODE_SANITISE_MAP)) {
    if (out.indexOf(bad) !== -1) out = out.split(bad).join(good);
  }
  out = out.replace(/[^\x00-\xFF]/g, '');
  return out;
}

function makePdfTextSafe(doc) {
  const originalText = doc.text.bind(doc);
  doc.text = function (text, ...rest) {
    return originalText(sanitiseForPdf(text), ...rest);
  };
  return doc;
}

// ── Grade label normalisation ──────────────────────────────────────────────
//
// Grade may arrive here as an integer (7), a "Grade N" string, or — from
// historically-corrupted DB rows — a "7.0"-style float string (see the
// ROOT CAUSE FIX comment in usageTracker.js#updateTeacherProfile). This
// normalises any of those shapes to a clean "Grade N" label so the header,
// subtitle, PDF metadata, and filename can never print "Grade 7.0" again,
// regardless of what any caller passes in.
//
// @param {string|number} grade
// @returns {string} - "Grade N", or '' if grade doesn't parse to 1-12
function formatGradeLabel(grade) {
  if (grade === null || grade === undefined || grade === '') return '';
  const str = String(grade).trim();
  const match = str.match(/(\d+(?:\.\d+)?)/);
  if (!match) return '';
  const num = parseInt(match[1], 10); // truncates any ".0" etc.
  if (Number.isNaN(num) || num < 1 || num > 12) return '';
  return `Grade ${num}`;
}

// ── Pagination helper ──────────────────────────────────────────────────────

/**
 * The usable content height on the page (between top and bottom margins).
 * Used to decide whether a new page is needed before drawing an element.
 */
function contentBottom(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

/**
 * Ensures there is at least `neededHeight` points of vertical space remaining
 * on the current page before an element is drawn.  If not, a new page is added
 * (which fires the pageAdded event — drawing the header/footer — and resets
 * doc.y to the top-margin position).
 *
 * Use this before ANY drawing call that passes an explicit `y` coordinate
 * (rect, stroke, moveTo, text with explicit y) because those calls bypass
 * PDFKit's built-in wrap-based pagination entirely.
 *
 * @param {PDFDocument} doc
 * @param {number} neededHeight - Minimum vertical space required in points
 */
function ensureSpace(doc, neededHeight) {
  if (doc.y + neededHeight > contentBottom(doc)) {
    doc.addPage();
  }
}

// ── Utility helpers ────────────────────────────────────────────────────────

/**
 * Draws the standard school document header.
 *
 * @param {PDFDocument} doc
 * @param {{ title, grade, subject, school, date }} meta
 */
function drawHeader(doc, { title, grade, subject, school, date, marks } = {}) {
  const pageWidth = doc.page.width;
  const margin    = 50;

  // Header background bar
  doc
    .rect(0, 0, pageWidth, 80)
    .fill(COLORS.primary);

  // PDFKit throws a LineWrapper infinite-recursion when doc.text() is called at a y
  // position that is above the page's top margin (here top=110, but header text
  // sits at y=14–56). Temporarily zero the top margin so text() can address those
  // positions safely, then restore it afterwards.
  const savedTopMargin = doc.page.margins.top;
  doc.page.margins.top = 0;

  // School name (top left, white)
  doc
    .font(FONTS.heading)
    .fontSize(9)
    .fillColor(COLORS.white)
    .text(school || 'SA Teacher Assistant', margin, 14, { width: pageWidth - margin * 2 - 90, lineBreak: false });

  // "CAPS Aligned" badge (top right, green pill) — small brand mark repeated
  // on every page so any single printed/shared page is recognisable.
  const badgeLabel = 'CAPS ALIGNED';
  const badgeW = 88;
  const badgeH = 16;
  const badgeX = pageWidth - margin - badgeW;
  const badgeY = 10;
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 8).fill(COLORS.accent);
  doc
    .font(FONTS.heading)
    .fontSize(7)
    .fillColor(COLORS.white)
    .text(badgeLabel, badgeX, badgeY + 5, { width: badgeW, align: 'center', lineBreak: false });

  // Document title (bold, centered)
  doc
    .font(FONTS.heading)
    .fontSize(16)
    .fillColor(COLORS.white)
    .text(title || '', margin, 28, { width: pageWidth - margin * 2, align: 'center', lineBreak: false });

  // Subtitle row: Subject | Grade | Date | Total Marks
  const subtitleParts = [subject, grade, date || new Date().toLocaleDateString('en-ZA')];
  if (marks) subtitleParts.push(`Total: ${marks} Marks`);
  const subtitle = subtitleParts.filter(Boolean).join('   |   ');
  doc
    .font(FONTS.body)
    .fontSize(9)
    .fillColor('#b0c4de')
    .text(subtitle, margin, 56, { width: pageWidth - margin * 2, align: 'center', lineBreak: false });

  // Restore top margin before any further content rendering
  doc.page.margins.top = savedTopMargin;

  // Green accent line below header
  doc
    .rect(0, 80, pageWidth, 4)
    .fill(COLORS.accent);

  doc.y = 100; // Reset cursor below header
}

/**
 * Draws the learner/teacher info box (Learner Name / Class / Teacher / Date / Total).
 * Rendered inside a light bordered box, two rows of fields, for a more
 * professional "official document" feel than a bare underline row.
 *
 * @param {PDFDocument} doc
 * @param {number} totalMarks
 */
function drawStudentInfoRow(doc, totalMarks) {
  const margin = 50;
  const boxW   = doc.page.width - margin * 2;
  const boxTop = doc.y + 6;
  const rowH   = 26;
  const boxH   = rowH * 2 + 8;

  doc.rect(margin, boxTop, boxW, boxH).lineWidth(0.75).stroke(COLORS.border);

  const drawField = (label, x, y, underlineWidth) => {
    doc.font(FONTS.body).fontSize(10).fillColor(COLORS.darkText).text(label, x, y, { lineBreak: false });
    const labelWidth = doc.font(FONTS.body).fontSize(10).widthOfString(label);
    doc.moveTo(x + labelWidth + 6, y + 12).lineTo(x + labelWidth + 6 + underlineWidth, y + 12).stroke(COLORS.midGray);
  };

  // Row 1: Learner Name (wide) | Class | Date
  const row1Y = boxTop + 8;
  const nameW = boxW * 0.46;
  const classW = boxW * 0.24;
  const dateW = boxW * 0.24;
  drawField('Learner Name:', margin + 10, row1Y, nameW - 100);
  drawField('Class:', margin + 10 + nameW, row1Y, classW - 55);
  drawField('Date:', margin + 10 + nameW + classW, row1Y, dateW - 50);

  // Row 2: Teacher (wide) | Total marks (bold, accent, right-aligned)
  const row2Y = row1Y + rowH;
  const teacherW = boxW * 0.6;
  drawField('Teacher:', margin + 10, row2Y, teacherW - 65);
  doc
    .font(FONTS.heading)
    .fontSize(11)
    .fillColor(COLORS.accent)
    .text(`Total: ___ / ${totalMarks || '___'} marks`, margin + 10 + teacherW, row2Y - 1, {
      width: boxW - teacherW - 20,
      align: 'right',
    });

  doc.y = boxTop + boxH + 10;
}

/**
 * Draws an instructions box near the top of assessment-style documents
 * (worksheets, tests, exam papers, quizzes, SBA tasks). Wording adapts
 * slightly to the document type and total marks.
 *
 * @param {PDFDocument} doc
 * @param {{ type: string, marks?: number }} opts
 */
function drawInstructionsBox(doc, { type, marks } = {}) {
  const margin = 50;
  const boxW   = doc.page.width - margin * 2;
  const assessmentTypes = ['worksheet', 'test', 'examPaper', 'sbaTask'];
  if (!assessmentTypes.includes(type)) return;

  const lines = ['Answer ALL questions.', 'Show ALL working where applicable.'];
  if (marks) lines.push(`This paper is out of ${marks} marks.`);
  if (type === 'test' || type === 'examPaper') lines.push('No calculators unless stated otherwise.');

  ensureSpace(doc, 20 + lines.length * 13 + 12);

  const boxTop = doc.y;
  const lineH = 13;
  const boxH = 20 + lines.length * lineH;

  doc.rect(margin, boxTop, boxW, boxH).fill(COLORS.lightGray);
  // Accent stripe on the left edge, matching the section-heading box treatment.
  doc.rect(margin, boxTop, 3, boxH).fill(COLORS.accent);

  doc
    .font(FONTS.heading)
    .fontSize(9)
    .fillColor(COLORS.primary)
    .text('INSTRUCTIONS', margin + 12, boxTop + 6, { lineBreak: false });

  lines.forEach((line, i) => {
    doc
      .font(FONTS.body)
      .fontSize(9)
      .fillColor(COLORS.darkText)
      .text(`•  ${line}`, margin + 12, boxTop + 20 + i * lineH, { width: boxW - 24, lineBreak: false });
  });

  doc.y = boxTop + boxH + 10;
}

/**
 * Draws a section heading (e.g. "SECTION A: Multiple Choice").
 *
 * @param {PDFDocument} doc
 * @param {string} heading
 * @param {string} [marks]
 */
function drawSectionHeading(doc, heading, marks) {
  const margin = 50;

  // Ensure enough room for the heading box (22pt) + top spacing (6pt) + bottom spacing (6pt)
  ensureSpace(doc, 34);

  const y = doc.y + 6;

  doc
    .rect(margin, y, doc.page.width - margin * 2, 22)
    .fill(COLORS.lightGray);

  doc
    .font(FONTS.heading)
    .fontSize(10)
    .fillColor(COLORS.primary)
    .text(heading, margin + 8, y + 6);

  if (marks) {
    doc
      .font(FONTS.body)
      .fontSize(9)
      .fillColor(COLORS.midGray)
      .text(marks, margin + 8, y + 6, { width: doc.page.width - margin * 2 - 16, align: 'right' });
  }

  doc.y = y + 28;
}

/**
 * Draws the footer on each page.
 * Called automatically via the `pageAdded` event.
 *
 * @param {PDFDocument} doc
 * @param {string} [schoolName]
 */
function drawFooter(doc, schoolName) {
  const pageWidth = doc.page.width;
  const y = doc.page.height - 36;

  doc
    .moveTo(50, y)
    .lineTo(pageWidth - 50, y)
    .stroke(COLORS.border);

  // Text at y = pageHeight-36 sits below the bottom-margin content boundary.
  // Temporarily zero the bottom margin so pdfkit doesn't auto-add a page (which
  // would re-fire pageAdded → drawFooter → infinite loop).
  // Also save/restore doc.y so the footer never leaks its cursor position into
  // the content area (which would make every new page start near the bottom).
  const savedBottom = doc.page.margins.bottom;
  const savedY = doc.y;
  doc.page.margins.bottom = 0;

  const genDate = new Date().toLocaleDateString('en-ZA');
  doc
    .font(FONTS.body)
    .fontSize(8)
    .fillColor(COLORS.midGray)
    .text(`Generated by SA Teacher Assistant — CAPS Aligned — ${genDate}`, 50, y + 6, { align: 'left', lineBreak: false, width: pageWidth - 150 });

  doc.page.margins.bottom = savedBottom;
  doc.y = savedY; // Restore cursor — never let footer position bleed into content
}

/**
 * Draws "Page X of Y" on the right side of the footer.
 *
 * Split out from drawFooter because the total page count (Y) isn't known
 * until the whole document has finished rendering — pdfkit streams pages
 * as content is added, so at pageAdded-time all we can know is "this is
 * page N so far", never the eventual total. drawFooter's "Page N" text
 * (with no "of Y") shipped from that limitation: it printed whatever
 * doc.bufferedPageRange().start was at the moment each page was created.
 *
 * The fix is the standard pdfkit two-pass pattern: construct the doc with
 * `bufferPages: true`, render all content first (drawFooter still runs on
 * each pageAdded for the line + "Generated by" text, which don't need the
 * total), then after rendering — once bufferedPageRange().count gives the
 * real total — loop back over every buffered page with switchToPage() and
 * stamp this page-number text on each one, before finally calling doc.end().
 *
 * @param {PDFDocument} doc
 * @param {number} pageNum - 1-indexed page number
 * @param {number} totalPages
 */
function drawPageNumber(doc, pageNum, totalPages) {
  const pageWidth = doc.page.width;
  const y = doc.page.height - 36;
  const savedBottom = doc.page.margins.bottom;
  const savedY = doc.y;
  doc.page.margins.bottom = 0;

  doc
    .font(FONTS.body)
    .fontSize(8)
    .fillColor(COLORS.midGray)
    .text(`Page ${pageNum} of ${totalPages}`, 50, y + 6, { align: 'right', width: pageWidth - 100, lineBreak: false });

  doc.page.margins.bottom = savedBottom;
  doc.y = savedY;
}

/**
 * Stamps "Page X of Y" on every buffered page of a finished document.
 * Call this after all content has been rendered but before doc.end().
 * Requires the doc to have been constructed with `bufferPages: true`.
 *
 * @param {PDFDocument} doc
 */
function stampPageNumbers(doc) {
  const range = doc.bufferedPageRange(); // { start, count } — count is only accurate now that rendering is done
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawPageNumber(doc, i - range.start + 1, range.count);
  }
}

/**
 * Draws a subtle right-aligned metadata line (Difficulty / Bloom Level /
 * Est. time) below the student info / instructions block. Silent no-op if
 * none of these values is actually supplied, so documents generated by call
 * sites that don't pass this data yet are unaffected.
 *
 * @param {PDFDocument} doc
 * @param {{ difficulty?: string, bloomLevel?: string, estimatedTime?: string }} meta
 */
function drawMetadataBox(doc, { difficulty, bloomLevel, estimatedTime } = {}) {
  const parts = [];
  if (difficulty)     parts.push(`Difficulty: ${difficulty}`);
  if (bloomLevel)      parts.push(`Bloom Level: ${bloomLevel}`);
  if (estimatedTime)   parts.push(`Est. time: ${estimatedTime}`);
  if (parts.length === 0) return; // nothing to show — stay invisible

  const margin = 50;
  const label = parts.join('   •   ');

  ensureSpace(doc, 16);
  doc
    .font(FONTS.italic)
    .fontSize(7.5)
    .fillColor(COLORS.midGray)
    .text(label, margin, doc.y, { width: doc.page.width - margin * 2, align: 'right', lineBreak: false });
  doc.y += 12;
}

// ── Number line ──────────────────────────────────────────────────────────
//
// The AI emits a single-line structured spec (see NUMBER LINES section of
// prompts/worksheet.js) instead of improvised ASCII art. ASCII art built
// from dashes/pipes/spaced digits only aligns in a monospace font, and even
// then two separate lines (ruler + labels) require multi-line lookahead
// that renderFormattedText's single-pass, line-at-a-time loop doesn't have.
// Drawing real vector graphics sidesteps both problems: tick positions are
// actual x-coordinates, not character columns, so no font/alignment issue
// is possible, and the whole thing is one self-contained line to parse.
const NUMBERLINE_RE = /^\[NUMBERLINE\s+([^\]]+)\]$/i;

// Parses "key=value key2="quoted value" ..." into a plain object. Quoted
// values may contain spaces (used by label="..."); unquoted values may not.
function parseNumberLineSpec(str) {
  const spec = {};
  const re = /(\w+)=("[^"]*"|[^\s]+)/g;
  let m;
  while ((m = re.exec(str))) {
    let val = m[2];
    if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') {
      val = val.slice(1, -1);
    }
    spec[m[1]] = val;
  }
  return spec;
}

// Splits a comma-separated list of numbers (e.g. "mark=-3,4") into floats,
// silently dropping anything that doesn't parse — malformed AI output
// shouldn't crash PDF generation, it should just render a plainer number line.
function parseNumberList(str) {
  if (!str) return [];
  return str.split(',').map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n));
}

/**
 * Draws a CAPS-style number line as real vector graphics: a horizontal
 * line with arrowheads, evenly-spaced tick marks with numeric labels,
 * optional solid dots (mark=), open circles (open=, for strict
 * inequalities), a shaded directional ray (ray=value,left|right), and an
 * optional caption below.
 *
 * @param {PDFDocument} doc
 * @param {number} margin
 * @param {number} bodyWidth
 * @param {{from:string, to:string, step?:string, mark?:string, open?:string, ray?:string, label?:string}} spec
 */
function drawNumberLine(doc, margin, bodyWidth, spec) {
  const from = parseFloat(spec.from);
  const to = parseFloat(spec.to);
  let step = spec.step ? parseFloat(spec.step) : 1;

  // Malformed spec (non-numeric range, zero/negative step, or an
  // absurdly dense line that would just smear into unreadable ink) —
  // skip drawing rather than throw and abort the whole PDF.
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from || Number.isNaN(step) || step <= 0) return;
  const tickCount = Math.round((to - from) / step) + 1;
  if (tickCount < 2 || tickCount > 41) return;

  const hasLabel = !!spec.label;
  const lineH = 46 + (hasLabel ? 16 : 0);
  ensureSpace(doc, lineH);

  const padX = 24; // room for arrowheads at each end
  const top = doc.y + (hasLabel ? 16 : 6);
  const x0 = margin + padX;
  const x1 = margin + bodyWidth - padX;
  const usableW = x1 - x0;
  const valueToX = (v) => x0 + ((v - from) / (to - from)) * usableW;

  if (hasLabel) {
    doc.font(FONTS.heading).fontSize(9).fillColor(COLORS.primary)
      .text(spec.label, margin, doc.y, { width: bodyWidth, align: 'center', lineBreak: false });
  }

  // Directional shaded ray (drawn under the main line so the main line's
  // arrowheads and ticks stay crisp on top of it), e.g. "ray=3,right" for
  // the solution set of x > 3.
  if (spec.ray) {
    const [rawVal, dir] = spec.ray.split(',').map((s) => s.trim());
    const rv = parseFloat(rawVal);
    if (!Number.isNaN(rv) && (dir === 'left' || dir === 'right')) {
      const rx = valueToX(Math.max(from, Math.min(to, rv)));
      const rayEndX = dir === 'right' ? x1 : x0;
      doc.moveTo(rx, top).lineTo(rayEndX, top).lineWidth(3).strokeColor(COLORS.accent).stroke();
    }
  }

  // Main line with arrowheads at both ends
  doc.lineWidth(1.25).strokeColor(COLORS.darkText);
  doc.moveTo(x0 - 8, top).lineTo(x1 + 8, top).stroke();
  const arrow = (tipX, dir) => {
    doc.moveTo(tipX, top)
      .lineTo(tipX - dir * 6, top - 4)
      .moveTo(tipX, top)
      .lineTo(tipX - dir * 6, top + 4)
      .stroke();
  };
  arrow(x1 + 8, 1);
  arrow(x0 - 8, -1);

  // Ticks + numeric labels
  doc.font(FONTS.body).fontSize(8).fillColor(COLORS.darkText);
  for (let i = 0; i < tickCount; i++) {
    const v = from + i * step;
    const x = valueToX(v);
    doc.moveTo(x, top - 5).lineTo(x, top + 5).lineWidth(1).strokeColor(COLORS.darkText).stroke();
    const label = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
    doc.text(label, x - 12, top + 8, { width: 24, align: 'center', lineBreak: false });
  }

  // Solid dots (closed points — e.g. x >= 3)
  parseNumberList(spec.mark).forEach((v) => {
    if (v < from || v > to) return;
    const x = valueToX(v);
    doc.circle(x, top, 4).fill(COLORS.primary);
  });

  // Open circles (strict points — e.g. x > 3)
  parseNumberList(spec.open).forEach((v) => {
    if (v < from || v > to) return;
    const x = valueToX(v);
    doc.circle(x, top, 4).lineWidth(1.25).fillColor(COLORS.white).fill().strokeColor(COLORS.primary).stroke();
  });

  doc.y = top + 22;
}

// ── Table helper ───────────────────────────────────────────────────────────

/**
 * Draws a table header row (navy background, white bold text).
 * Called on the first row of a table AND whenever the table spans a page break.
 *
 * @param {PDFDocument} doc
 * @param {string[]} cells
 * @param {number} margin
 * @param {number} bodyWidth
 * @param {number} rowHeight
 */
/**
 * Computes the row height needed to fit the tallest cell in a table row
 * WITHOUT truncating any content — this is what makes table wrapping
 * possible instead of the previous fixed-height + ellipsis approach, which
 * hard-truncated any cell content that didn't fit on one line (e.g.
 * "Properties…", "Investigation/Assignment 1 (50…").
 *
 * @param {PDFDocument} doc
 * @param {string[]} cells
 * @param {number} colWidth
 * @param {number} minHeight - Floor height (e.g. single-line row height)
 * @returns {number}
 */
function computeRowHeight(doc, cells, colWidthOrWidths, minHeight) {
  let maxH = minHeight;
  cells.forEach((cell, i) => {
    const w = Array.isArray(colWidthOrWidths) ? colWidthOrWidths[i] : colWidthOrWidths;
    const h = doc.heightOfString(cell || '', { width: w - 8 }) + 8;
    if (h > maxH) maxH = h;
  });
  return maxH;
}

// Normalises a colWidths argument into an array of per-column widths.
// Accepts either a single number (equal-width columns, divided from
// bodyWidth) or an array of explicit per-column widths (variable-width
// columns, e.g. the Report Summary table's [Learner, Mark, Comment]).
function resolveColWidthsArray(colWidths, colCount, bodyWidth) {
  if (Array.isArray(colWidths)) return colWidths;
  const w = bodyWidth / colCount;
  return new Array(colCount).fill(w);
}

function drawTableHeaderRow(doc, cells, margin, bodyWidthOrWidths, rowHeight) {
  const colCount = cells.length;
  const widths = Array.isArray(bodyWidthOrWidths)
    ? bodyWidthOrWidths
    : resolveColWidthsArray(bodyWidthOrWidths, colCount, bodyWidthOrWidths);
  const bodyWidth = widths.reduce((a, b) => a + b, 0);
  const rowY = doc.y;

  doc.rect(margin, rowY, bodyWidth, rowHeight).fill(COLORS.primary);

  let x = margin;
  cells.forEach((cell, i) => {
    doc.font(FONTS.heading)
       .fontSize(9)
       .fillColor(COLORS.white)
       .text(cell, x + 4, rowY + 4, {
         width: widths[i] - 8,
         // No fixed `height` / `ellipsis` here — the row height passed in
         // is already computed (via computeRowHeight) to fit the tallest
         // cell's wrapped content, so text wraps naturally instead of
         // being cut off with "…".
       });
    x += widths[i];
  });

  doc.strokeColor(COLORS.border).lineWidth(0.5);
  x = margin;
  for (let i = 1; i < colCount; i++) {
    x += widths[i - 1];
    doc.moveTo(x, rowY).lineTo(x, rowY + rowHeight).stroke();
  }
  doc.rect(margin, rowY, bodyWidth, rowHeight).stroke();

  doc.y = rowY + rowHeight + 1;
}

// Draws one data row of a table with variable (or equal) column widths,
// wrapping content instead of truncating it. Used by both the pipe-table
// renderer and the Report Summary table so there is exactly one table
// data-row implementation in the codebase.
function drawTableDataRow(doc, cells, margin, colWidthsOrWidth, rowHeight, options = {}) {
  const widths = Array.isArray(colWidthsOrWidth)
    ? colWidthsOrWidth
    : resolveColWidthsArray(colWidthsOrWidth, cells.length, colWidthsOrWidth);
  const rowY = doc.y;
  const bodyWidth = widths.reduce((a, b) => a + b, 0);

  if (options.striped) {
    doc.rect(margin, rowY, bodyWidth, rowHeight).fill(COLORS.lightGray);
  }

  let x = margin;
  doc.font(FONTS.body).fontSize(9).fillColor(COLORS.darkText);
  cells.forEach((cell, i) => {
    doc.text(cell || '', x + 4, rowY + 4, { width: widths[i] - 8 });
    x += widths[i];
  });

  doc.strokeColor(COLORS.border).lineWidth(0.5);
  x = margin;
  for (let i = 1; i < cells.length; i++) {
    x += widths[i - 1];
    doc.moveTo(x, rowY).lineTo(x, rowY + rowHeight).stroke();
  }
  doc.rect(margin, rowY, bodyWidth, rowHeight).stroke();

  doc.y = rowY + rowHeight + 1;
}

// Formats a mark for display, e.g. "78/100" or "45%". Guards against
// undefined/null `mark` — previously this fell through to a bare template
// literal (`${c.mark}%`) which rendered the literal string "undefined%"
// whenever a comment had no mark recorded.
function formatMarkStr(c) {
  if (c.mark === undefined || c.mark === null || c.mark === '') return '—';
  return c.outOf ? `${c.mark}/${c.outOf}` : `${c.mark}%`;
}

// ── Text parser: convert WhatsApp-formatted AI output to PDF elements ──────

/**
 * Parses WhatsApp-formatted text (*bold*, bullet points, numbered lists)
 * and writes it to the PDF with proper formatting.
 *
 * The AI returns content formatted for WhatsApp — we convert that to
 * clean PDF formatting here.
 *
 * @param {PDFDocument} doc
 * @param {string} text - AI-generated WhatsApp-formatted content
 * @param {number} margin
 */
function renderFormattedText(doc, text, margin = 50) {
  const lines = text.split('\n');
  const bodyWidth = doc.page.width - margin * 2;
  const ROW_HEIGHT = 18;

  // Reset pipe-table state for this render pass
  delete doc._atpTableHeader;
  delete doc._atpTableHeaderCells;
  doc._atpRowCount = 0;

  for (const raw of lines) {
    let line = raw.trim();

    // Normalise markdown **bold** to the *bold* style the rest of this
    // parser is written for. The AI is instructed to use single-asterisk
    // *bold* (WhatsApp style), but models sometimes drift back to standard
    // markdown double-asterisks — without this, "**text**" printed
    // literally instead of being bolded (asterisks and all), since none of
    // the single-asterisk regexes below matched it.
    line = line.replace(/\*\*/g, '*');

    // Skip header lines — already rendered in drawHeader
    if (line.startsWith('*WORKSHEET:') || line.startsWith('*LESSON PLAN:') ||
        line.startsWith('*TEST PAPER') || line.startsWith('*MEMORANDUM')) {
      continue;
    }

    // Skip the subject/grade/total subtitle line — drawHeader already renders
    // this as the subtitle row (e.g. "*Mathematics | Grade 7 | Total: ____/25*").
    // Only matches when the ENTIRE line is one bold span containing "Total:",
    // so it can't accidentally eat other bold headings or the marking grid line.
    if (/^\*[^*]*Total:[^*]*\*$/.test(line)) {
      continue;
    }

    // Skip the logo placeholder row — real logos aren't generated as text;
    // the header bar itself is the reserved branding space.
    if (/\[school logo\]/i.test(line) || /\[sa teacher assistant logo\]/i.test(line)) {
      continue;
    }

    // Skip Name:/Class:/Date: field lines from the AI text — drawStudentInfoRow
    // already renders these as fillable underlines directly under the header.
    if (/^\*?Name:\*?/i.test(line) || /^\*?Class:\*?/i.test(line)) {
      continue;
    }

    // Number line spec: [NUMBERLINE from=-10 to=10 step=1 mark=-3,4 ...]
    // See prompts/worksheet.js "NUMBER LINES" instructions — the AI emits
    // this instead of improvised ASCII art (see drawNumberLine's doc
    // comment for why ASCII art doesn't work with this parser).
    const numberLineMatch = line.match(NUMBERLINE_RE);
    if (numberLineMatch) {
      const spec = parseNumberLineSpec(numberLineMatch[1]);
      drawNumberLine(doc, margin, bodyWidth, spec);
      continue;
    }

    // Markdown ATX headers (#, ##, ###...) — like the ** normalisation
    // above, this is defensive handling for when the AI drifts to standard
    // markdown instead of the *bold* style it's instructed to use. Without
    // this, headers printed literally with their leading "#" characters
    // (e.g. "# ANNUAL TEACHING PLAN 2026", "## TERM 1 (Weeks 1-10)").
    const atxMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (atxMatch) {
      const headingText = atxMatch[2].replace(/\*/g, '').trim();
      const level = atxMatch[1].length;
      if (level === 1) {
        // Top-level "# Document Title" duplicates what drawHeader already
        // renders in the page header bar — skip it, same as the *WORKSHEET:/
        // *MEMORANDUM skip logic above for the WhatsApp-style equivalent.
        continue;
      }
      drawSectionHeading(doc, headingText);
      continue;
    }

    // Section dividers (═══ or ---). Threshold is 3, not 4 — a standard
    // markdown horizontal rule is exactly "---" (3 characters). At 4+ this
    // branch was never reached for real markdown dividers: "---" instead
    // fell through to the bullet-point check below (which only strips a
    // single leading "-"), rendering as a stray "• --" bullet.
    if (/^[═=─-]{3,}$/.test(line)) {
      ensureSpace(doc, 16);
      doc.y += 4;
      doc.moveTo(margin, doc.y).lineTo(doc.page.width - margin, doc.y).stroke(COLORS.border);
      doc.y += 8;
      continue;
    }

    // Any non-pipe line resets the table-header flag so that the NEXT table
    // encountered later in the document gets a fresh navy header row.
    if (!line.startsWith('|')) {
      delete doc._atpTableHeader;
      delete doc._atpTableHeaderCells;
    }

    // Markdown pipe-table row: | col1 | col2 | ...
    // Separator rows like |---|---| are skipped (they're just visual dividers in markdown)
    if (line.startsWith('|') && line.endsWith('|')) {
      // Skip separator rows (e.g. |---|---|---)
      if (/^\|[\s\-:]+(\|[\s\-:]+)+\|$/.test(line)) {
        continue;
      }
      // Strip markdown bold markers (*text* or the already-normalised form
      // of **text**) from cell content. Table cells are drawn with a single
      // doc.text() call per cell, so mixed bold/normal runs aren't rendered
      // as true bold — but leaving the asterisks in was worse: they printed
      // literally (e.g. "**Whole Numbers:**"), which is the actual bug seen
      // in production ATP/moderation-pack tables.
      const cells = line.split('|').slice(1, -1).map(c => c.trim().replace(/\*/g, ''));
      const colCount = cells.length;
      if (colCount > 0) {
        const colWidth = bodyWidth / colCount;
        const isHeader = doc._atpTableHeader === undefined; // first row treated as header

        if (isHeader) {
          // Cache header cells for repeating on page breaks
          doc._atpTableHeader = true;
          doc._atpTableHeaderCells = cells;
          doc._atpRowCount = 0;

          doc.font(FONTS.heading).fontSize(9);
          const headerRowHeight = computeRowHeight(doc, cells, colWidth, ROW_HEIGHT);

          // Ensure room for header row + at least one data row
          ensureSpace(doc, headerRowHeight + ROW_HEIGHT);
          drawTableHeaderRow(doc, cells, margin, bodyWidth, headerRowHeight);
          continue;
        }

        // Data row — compute the height needed to fit this row's content
        // WITHOUT truncating (this is the fix for cells like "Properties…"
        // being cut off: previously every row used a fixed ROW_HEIGHT=18
        // with ellipsis:true, which hard-truncated anything that didn't
        // fit on one line).
        doc.font(FONTS.body).fontSize(9);
        const rowHeight = computeRowHeight(doc, cells, colWidth, ROW_HEIGHT);

        // Check if it fits; if not, start new page and repeat header
        ensureSpace(doc, rowHeight + 2);

        // If ensureSpace triggered a page break, doc.y is now at top-of-content.
        // Repeat the table header on the new page so the table is self-contained.
        if (doc._atpTableHeaderCells && doc.y < 130) {
          // doc.y < 130 means we just came from a fresh page (header sets y=100)
          doc.font(FONTS.heading).fontSize(9);
          const repeatHeaderHeight = computeRowHeight(doc, doc._atpTableHeaderCells, colWidth, ROW_HEIGHT);
          drawTableHeaderRow(doc, doc._atpTableHeaderCells, margin, bodyWidth, repeatHeaderHeight);
          doc._atpRowCount = 0; // restart stripe pattern after repeated header
        }

        const rowY = doc.y;
        const rowBg = (doc._atpRowCount % 2 === 0) ? COLORS.lightGray : COLORS.white;

        // Row background
        doc.rect(margin, rowY, bodyWidth, rowHeight).fill(rowBg);
        doc._atpRowCount++;

        // Cell text — no fixed `height`/`ellipsis`; wraps within rowHeight
        cells.forEach((cell, i) => {
          doc.font(FONTS.body)
             .fontSize(9)
             .fillColor(COLORS.darkText)
             .text(cell, margin + i * colWidth + 4, rowY + 4, {
               width: colWidth - 8,
             });
        });

        // Cell dividers
        doc.strokeColor(COLORS.border).lineWidth(0.5);
        for (let i = 1; i < colCount; i++) {
          doc.moveTo(margin + i * colWidth, rowY).lineTo(margin + i * colWidth, rowY + rowHeight).stroke();
        }
        doc.rect(margin, rowY, bodyWidth, rowHeight).stroke();

        doc.y = rowY + rowHeight + 1;
        continue;
      }
    }

    // Bold section heading: *HEADING TEXT* or *Mixed Case Heading*
    // Matches any line that is ENTIRELY wrapped in one *...* pair and is
    // short enough to be a heading (≤80 chars of inner text, no trailing sentence punct).
    if (/^\*[^*]{1,80}\*$/.test(line) && !/^\*[^*]*\.\s*\*$/.test(line)) {
      const heading = line.replace(/^\*|\*$/g, '');
      // Only treat as section heading if it looks like a title (no lowercase mid-sentence
      // conjunctions starting the text, not a full sentence). This heuristic is broad
      // enough to catch "TERM 1 (Weeks 1–10)", "Assessment Overview", "Parent Message", etc.
      drawSectionHeading(doc, heading);
      continue;
    }

    // Bold inline: *text* mixed with normal text
    if (line.includes('*') && !line.startsWith('•') && !line.startsWith('-')) {
      doc.font(FONTS.body).fontSize(10);
      const estimatedH = measureInlineBoldHeight(doc, line, margin, bodyWidth) + 2;
      ensureSpace(doc, estimatedH);
      renderInlineBold(doc, line, margin, bodyWidth);
      doc.y += 2;
      continue;
    }

    // Bullet point: • or -
    // Routed through renderInlineBold (instead of a plain .text() call) so
    // *bold* spans inside bullets — very common in Notes/CAPS-reference
    // sections, e.g. "- *Teaching time:* 7 hours per week" — get their
    // asterisks parsed into actual bold formatting instead of printing the
    // literal "*" characters. Previously the bullet branch never stripped
    // or interpreted "*", because the bold-inline branch above explicitly
    // excludes lines starting with "-"/"•" and hands them off here instead.
    if (line.startsWith('•') || (line.startsWith('-') && line.length > 2)) {
      const bulletText = line.replace(/^[•\-]\s*/, '');
      doc.font(FONTS.body).fontSize(10);
      const estimatedH = measureInlineBoldHeight(doc, bulletText, margin, bodyWidth, margin + 20) + 2;
      ensureSpace(doc, estimatedH);
      const startY = doc.y;
      doc
        .font(FONTS.body).fontSize(10).fillColor(COLORS.darkText)
        .text('•', margin + 4, startY, { continued: false, width: 12 });
      doc.y = startY; // Reset cursor so the bullet text renders on the same line as the glyph
      renderInlineBold(doc, bulletText, margin, bodyWidth, margin + 20);
      continue;
    }

    // Numbered list: 1. text
    if (/^\d{1,2}[.)]\s/.test(line)) {
      const numMatch = line.match(/^(\d{1,2}[.)]\s)(.*)/);
      if (numMatch) {
        doc.font(FONTS.body).fontSize(10);
        const estimatedH = measureInlineBoldHeight(doc, numMatch[2], margin, bodyWidth, margin + 24) + 3;
        ensureSpace(doc, estimatedH);
        const startY = doc.y;
        doc
          .font(FONTS.heading).fontSize(10).fillColor(COLORS.darkText)
          .text(numMatch[1], margin + 4, startY, { continued: false, width: 20 });
        doc.y = startY;
        renderInlineBold(doc, numMatch[2], margin, bodyWidth, margin + 24);
        doc.y += 3;
        continue;
      }
    }

    // Mark allocation (trailing parenthetical marks): (1), (2), (3)
    if (/\(\d+\)$/.test(line)) {
      const marksMatch = line.match(/(.*?)\s*(\(\d+\))$/);
      if (marksMatch) {
        doc.font(FONTS.body).fontSize(10);
        const gutterWidth = bodyWidth - 40;
        const estimatedH = measureInlineBoldHeight(doc, marksMatch[1], margin, gutterWidth) + 2;
        ensureSpace(doc, estimatedH);
        const lineHeight = doc.currentLineHeight(true) + 2;
        renderInlineBold(doc, marksMatch[1], margin, gutterWidth);
        const marksY = doc.y - lineHeight;
        doc
          .font(FONTS.heading).fontSize(10).fillColor(COLORS.accent)
          .text(marksMatch[2], margin, marksY, { width: bodyWidth, align: 'right' });
        doc.y += 2;
        continue;
      }
    }

    // Answer lines (blank lines for writing)
    if (line.startsWith('Answer:') || line.startsWith('Working:')) {
      ensureSpace(doc, 30);
      doc.font(FONTS.italic).fontSize(10);
      renderInlineBold(doc, line, margin, bodyWidth, margin, COLORS.midGray);
      doc.y += 14; // Extra space for student to write
      continue;
    }

    // Empty line — add spacing
    if (line === '') {
      doc.y += 6;
      continue;
    }

    // Default: normal body text
    doc.font(FONTS.body).fontSize(10);
    const estimatedH = measureInlineBoldHeight(doc, line, margin, bodyWidth) + 2;
    ensureSpace(doc, estimatedH);
    renderInlineBold(doc, line, margin, bodyWidth);
    doc.y += 2;
  }
}

/**
 * Renders a line that contains mixed *bold* and normal text inline, AND
 * any inline maths (fractions, exponents, roots — in LaTeX, Unicode-glyph,
 * or plain-ASCII form) as real typeset visuals rather than plain-text
 * approximations like "12/18" or "5^2".
 *
 * Delegates to services/mathTypeset: buildAtoms() tokenizes the line into
 * an ordered list of word/space/frac/exp/sqrt atoms (each tagged with
 * whether it's inside a *bold* span), and layoutAtoms() greedily word-wraps
 * them within [startX, startX+availWidth], drawing stacked fractions and
 * radical signs as small vector graphics inline with the text — something
 * PDFKit's own continued-text chaining has no way to do on its own, since
 * it only handles text runs, not inline non-text objects.
 *
 * @param {PDFDocument} doc
 * @param {string} line
 * @param {number} margin
 * @param {number} width
 * @param {number} [startX=margin] - X position to start drawing at (e.g.
 *   margin + 20 for bullet text that's indented past a bullet glyph). The
 *   available width is reduced by (startX - margin) to keep wrapping correct.
 */
function renderInlineBold(doc, line, margin, width, startX = margin, color = COLORS.darkText) {
  const availWidth = width - (startX - margin);
  const atoms = buildAtoms(line);
  const endY = layoutAtoms(doc, atoms, {
    x: startX, y: doc.y, width: availWidth, fontSize: 10, color, dryRun: false,
  });
  doc.y = endY;
}

/**
 * Measures the height a line will take when rendered via renderInlineBold
 * WITHOUT drawing anything — used for the ensureSpace() pagination check
 * that must run before drawing, so a paragraph never gets cut off mid-page.
 * This replaces the old doc.heightOfString() estimate, which assumed plain
 * text and didn't know that a line containing a fraction might wrap at a
 * different point (fractions/roots have their own width, not the width of
 * their plain-text spelling).
 */
function measureInlineBoldHeight(doc, line, margin, width, startX = margin) {
  const availWidth = width - (startX - margin);
  const atoms = buildAtoms(line);
  const endY = layoutAtoms(doc, atoms, {
    x: startX, y: 0, width: availWidth, fontSize: 10, color: COLORS.darkText, dryRun: true,
  });
  return endY;
}

/**
 * Title-cases the first letter of every word, leaving the rest of each word
 * untouched (so acronyms like "SOH CAH TOA" or "NSC" stay intact). Used to
 * fix raw lowercase input (e.g. a teacher typing "fractions" or "mathematics"
 * over WhatsApp) before it's printed in the PDF header/title/filename —
 * the AI-generated body content already capitalizes correctly on its own,
 * but the PDF header/title strings are built separately from raw input.
 *
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
  if (!str) return str;
  return String(str).replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

// ── Main PDF generation function ───────────────────────────────────────────

/**
 * Generates a professional PDF from AI-generated content.
 *
 * @param {Object} params
 * @param {string} params.content   - Raw AI output (WhatsApp-formatted)
 * @param {string} params.type      - 'worksheet' | 'test' | 'lessonPlan' | 'explanation'
 * @param {string} params.topic     - e.g. "Algebra"
 * @param {string} params.grade     - e.g. "Grade 7"
 * @param {string} params.subject   - e.g. "Mathematics"
 * @param {string} [params.school]  - School name
 * @param {number} [params.marks]   - Total marks (for tests/worksheets)
 * @returns {Promise<{ filePath: string, filename: string, fileId: string }>}
 */
async function generatePdf({ content, type, topic, grade, subject, school, marks, difficulty, bloomLevel, estimatedTime }) {
  ensurePdfDir();

  // Normalize casing once here — content already comes back correctly
  // capitalized from the AI, but topic/grade/subject arrive as raw teacher
  // input (e.g. "fractions", "mathematics") and are used separately to
  // build the header/title/filename below.
  topic   = toTitleCase(topic);
  subject = toTitleCase(subject);

  // Normalise grade once, up front, so every downstream use (title
  // metadata, header, footer, filename) sees the same clean "Grade N"
  // label regardless of what shape the caller passed grade in — a bare
  // integer, "7", "7.0" (the better-sqlite3 TEXT-column coercion bug), or
  // an already-prefixed "Grade 7"/"Grade 7.0". toTitleCase alone does NOT
  // fix this (title-casing a decimal string is a no-op), so this must run
  // as its own step.
  grade = formatGradeLabel(grade);

  const fileId   = uuidv4();
  const filename = buildFilename(type, topic, grade);
  const filePath = path.join(PDF_DIR, `${fileId}.pdf`);

  const currentYear = new Date().getFullYear();

  const titles = {
    worksheet:   `WORKSHEET: ${topic}`,
    test:        `TEST: ${topic}`,
    lessonPlan:  `LESSON PLAN: ${topic}`,
    explanation: `EXPLANATION: ${topic}`,
    atp:         `ANNUAL TEACHING PLAN ${currentYear}: ${subject || 'CAPS'}`,
    assessmentAnalysis: `ASSESSMENT ANALYSIS: ${topic || subject || 'CAPS'}`,
    interventionPlan:   `INTERVENTION PLAN: ${topic || subject || 'CAPS'}`,
    diagnosticReport:   `DIAGNOSTIC REPORT: ${topic || subject || 'CAPS'}`,
    sbaTask:     `SBA TASK: ${topic}`,
    examPaper:   `EXAM PAPER: ${topic}`,
    rubric:      `RUBRIC: ${topic}`,
    moderationPack: `MODERATION PACK: ${topic || subject || 'CAPS'}`,
  };

  const title = titles[type] || `SA TEACHER ASSISTANT: ${topic || subject || 'CAPS'}`;

  // Document types where a learner fills in the PDF by hand (name/class/teacher
  // fields + an instructions box make sense). Teacher-facing planning docs
  // (lesson plans, ATPs, intervention plans, etc.) skip these.
  const ASSESSMENT_TYPES = new Set(['worksheet', 'test', 'examPaper', 'quickQuiz', 'sbaTask']);
  const isAssessment = ASSESSMENT_TYPES.has(type);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 110, bottom: 60, left: 50, right: 50 },
      bufferPages: true, // Required so bufferedPageRange().count is accurate for "Page X of Y" (see stampPageNumbers)
      info: {
        Title:    title,
        Author:   'SA Teacher Assistant',
        Subject:  `${subject} — ${grade}`,
        Creator:  'SA Teacher Assistant v2',
        Keywords: 'CAPS, South Africa, education',
      },
    });
    makePdfTextSafe(doc);

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const headerMeta = { title, grade, subject, school, date: new Date().toLocaleDateString('en-ZA'), marks };

    // Draw header on first page
    drawHeader(doc, headerMeta);

    // Draw learner/teacher info box + instructions for assessment-style docs
    if (isAssessment) {
      drawStudentInfoRow(doc, marks);
      drawInstructionsBox(doc, { type, marks });
    }

    // Subtle teacher-reference box — only appears if metadata was supplied
    drawMetadataBox(doc, { difficulty, bloomLevel, estimatedTime });

    // Add header + footer to each new page
    doc.on('pageAdded', () => {
      drawHeader(doc, headerMeta);
      drawFooter(doc, school);
    });

    // Draw footer on first page too
    drawFooter(doc, school);

    // Render the content
    renderFormattedText(doc, content);

    // Total page count is only known now that all content has been rendered —
    // stamp "Page X of Y" on every buffered page before finalizing the doc.
    stampPageNumbers(doc);

    doc.end();

    stream.on('finish', () => {
      console.log(`[PDF] Generated: ${filename} (${(fs.statSync(filePath).size / 1024).toFixed(1)}KB)`);
      resolve({ filePath, filename, fileId });
    });

    stream.on('error', reject);
  });
}

/**
 * Builds a clean, descriptive filename.
 * Example: "Grade_7_Mathematics_Worksheet_Algebra.pdf"
 *
 * @param {string} type
 * @param {string} topic
 * @param {string} grade
 * @returns {string}
 */
function buildFilename(type, topic, grade) {
  const typeLabel = {
    worksheet:   'Worksheet',
    test:        'Test',
    lessonPlan:  'Lesson_Plan',
    explanation: 'Explanation',
    atp:         'Annual_Teaching_Plan',
    assessmentAnalysis: 'Assessment_Analysis',
    interventionPlan:   'Intervention_Plan',
    diagnosticReport:   'Diagnostic_Report',
    sbaTask:     'SBA_Task',
    examPaper:   'Exam_Paper',
    rubric:      'Rubric',
    moderationPack: 'Moderation_Pack',
  }[type] || 'Document';

  // Strip grade references from topic (e.g., "Grade 7 fractions" -> "fractions")
  // Sanitise to prevent path traversal and security issues
  const safeTopic = (topic || 'Topic')
    .replace(/grade\s*\d+/gi, '')
    .replace(/[^\w\s-]/g, '') // Remove special chars except word, space, hyphen
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_') // Normalise hyphens to underscores
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

  // Sanitise grade to prevent path traversal; coerce integer grades to string.
  // Also strip any existing "Grade" word from the input first — callers pass
  // grade as either a bare number (7) or a full label ("Grade 7"), and
  // without this strip the literal "Grade_" prefix below gets duplicated
  // (e.g. "Grade_Grade_7_..." instead of "Grade_7_...").
  // Run through formatGradeLabel first so a decimal ("7.0") or an
  // already-prefixed label is reduced to a bare clean integer *before* the
  // regex below strips non-word characters — otherwise "7.0" loses its "."
  // silently and becomes "70" (a real bug that shipped filenames like
  // "Grade_70_...pdf" for what should have been "Grade_7_...pdf"). generatePdf
  // already normalises grade before calling this, but this is a second layer
  // of defense for any other caller.
  const gradeStr = formatGradeLabel(grade).replace(/^Grade\s*/i, '');
  const safeGrade = gradeStr
    ? gradeStr
        .replace(/grade/gi, '')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 20)
    : '';

  // Add date suffix in MMDD format
  const dateSuffix = new Date().toISOString().slice(5, 10).replace('-', '');

  // Build filename with grade prefix if grade is provided
  if (safeGrade) {
    return `Grade_${safeGrade}_${typeLabel}_${safeTopic}_${dateSuffix}.pdf`;
  } else {
    return `${typeLabel}_${safeTopic}_${dateSuffix}.pdf`;
  }
}

/**
 * Returns the file path for a given file ID.
 * Used by the PDF serving route.
 *
 * @param {string} fileId
 * @returns {string|null}
 */
function getPdfPath(fileId) {
  if (!fileId || !/^[0-9a-f\-]{36}$/.test(fileId)) return null; // Validate UUID format
  const filePath = path.join(PDF_DIR, `${fileId}.pdf`);
  return fs.existsSync(filePath) ? filePath : null;
}

/**
 * Deletes PDF files older than 2 hours.
 * Call this on a schedule (e.g., every hour via setInterval in server.js).
 */
function cleanupOldPdfs() {
  if (!fs.existsSync(PDF_DIR)) return;
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const now = Date.now();

  const files = fs.readdirSync(PDF_DIR);
  let deleted = 0;

  for (const file of files) {
    const filePath = path.join(PDF_DIR, file);
    const stat = fs.statSync(filePath);
    if (now - stat.mtimeMs > TWO_HOURS) {
      fs.unlinkSync(filePath);
      deleted++;
    }
  }

  if (deleted > 0) console.log(`[PDF] Cleaned up ${deleted} old PDF files`);
}

/**
 * Generates a compiled PDF of report comments with a summary table.
 *
 * @param {Array} comments - Array of comment objects: { learnerName, mark, outOf, behaviourNotes, comment }
 * @param {object} metadata - { grade, subject, school }
 * @returns {Promise<{ fileId: string, filename: string }>}
 */
async function generateReportSummaryPdf(comments, metadata = {}) {
  let { grade, subject, school } = metadata;
  grade = formatGradeLabel(grade);

  ensurePdfDir();

  const fileId = uuidv4(); // Use uuid for consistency (avoids collision)
  const filename = `Report_Comments_${grade || 'All'}_${subject || 'All'}.pdf`;
  const filePath = path.join(PDF_DIR, `${fileId}.pdf`); // FIX: was missing .pdf extension

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 110, bottom: 60, left: 50, right: 50 },
    bufferPages: true, // Required so bufferedPageRange().count is accurate for "Page X of Y" (see stampPageNumbers)
  });
  makePdfTextSafe(doc);

  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const title = 'REPORT COMMENTS SUMMARY';

  // FIX: drawHeader requires a single meta object — was incorrectly called
  // with positional args (drawHeader(doc, 'title', school, grade, subject))
  // which caused title/grade/subject/school to all be undefined.
  drawHeader(doc, { title, grade, subject, school, date: new Date().toLocaleDateString('en-ZA') });

  // Add footer to each new page
  doc.on('pageAdded', () => {
    drawHeader(doc, { title, grade, subject, school, date: new Date().toLocaleDateString('en-ZA') });
    drawFooter(doc, school);
  });

  drawFooter(doc, school);

  // Summary table
  doc.moveDown(0.5);
  doc.font(FONTS.heading).fontSize(12).fillColor(COLORS.darkText).text('Summary Table', { underline: true });
  doc.moveDown(0.5);

  const tableLeft = 50;
  const bodyWidth = doc.page.width - tableLeft * 2; // 495.28pt on A4 — the
  // old fixed widths [120, 60, 335] summed to 515pt, 20pt WIDER than this,
  // so the Comment column ran past the right margin. Widths below are
  // proportional to the old ratio (~24% / 12% / 64%) but scaled to fit
  // exactly within the printable body width.
  const colWidths = [
    Math.round(bodyWidth * 0.24),
    Math.round(bodyWidth * 0.12),
    0, // filled in below — absorbs rounding so the row is pixel-exact
  ];
  colWidths[2] = bodyWidth - colWidths[0] - colWidths[1];

  const HEADER_ROW_HEIGHT = 20;
  const MIN_ROW_HEIGHT = 20;

  ensureSpace(doc, HEADER_ROW_HEIGHT + MIN_ROW_HEIGHT);
  drawTableHeaderRow(doc, ['Learner', 'Mark', 'Comment (excerpt)'], tableLeft, colWidths, HEADER_ROW_HEIGHT);

  // Table rows — dynamic height so wrapped learner names / excerpts never
  // overlap the next row (previously a fixed 22pt row height truncated
  // nothing but also didn't grow, so any 2-line cell bled into the row below).
  comments.forEach((c, i) => {
    const markStr = formatMarkStr(c);
    // The AI always prefixes comments with a "*REPORT COMMENT*" label (see
    // prompts/reportComment.js) meant to render bold in the full-comment
    // view further down this document. Table cells, unlike that view, are
    // drawn with a single plain doc.text() call each — so without this
    // strip, the raw label's asterisks print literally in the PDF (e.g.
    // "*REPORT COMMENT* Thabo has..."), and the excerpt wastes most of its
    // 80-character budget on boilerplate instead of the actual comment.
    const cleanedComment = (c.comment || '')
      .replace(/^\s*\*+\s*report comment\s*\*+\s*/i, '')
      .replace(/\*/g, '')
      .trim();
    const excerpt = cleanedComment.substring(0, 80) + (cleanedComment.length > 80 ? '…' : '');
    const cells = [c.learnerName || '—', markStr, excerpt];

    const rowHeight = computeRowHeight(doc, cells, colWidths, MIN_ROW_HEIGHT);
    const yBefore = doc.y;
    ensureSpace(doc, rowHeight);
    if (doc.y !== yBefore) {
      // ensureSpace triggered a page break (doc.y reset to top margin) —
      // repeat the header row so the continuation isn't headerless.
      drawTableHeaderRow(doc, ['Learner', 'Mark', 'Comment (excerpt)'], tableLeft, colWidths, HEADER_ROW_HEIGHT);
    }
    drawTableDataRow(doc, cells, tableLeft, colWidths, rowHeight, { striped: i % 2 === 1 });
  });

  doc.moveDown(2);

  // Full comments — one per page after the first
  doc.font(FONTS.heading).fontSize(12).fillColor(COLORS.darkText).text('Full Comments', { underline: true });
  doc.moveDown(0.5);

  comments.forEach((c, i) => {
    if (i > 0) {
      doc.addPage();
    }

    const markStr = formatMarkStr(c);

    doc.font(FONTS.heading).fontSize(12).fillColor(COLORS.darkText).text(`Learner: ${c.learnerName || ''}`);
    doc.font(FONTS.body).fontSize(11).fillColor(COLORS.darkText).text(`Mark: ${markStr}`);
    if (c.behaviourNotes) {
      doc.font(FONTS.body).fontSize(11).fillColor(COLORS.darkText).text(`Behaviour: ${c.behaviourNotes}`);
    }
    doc.moveDown(0.5);

    doc.font(FONTS.body).fontSize(11);
    renderFormattedText(doc, c.comment || '');

    doc.moveDown(1);
  });

  // Total page count is only known now that all content has been rendered —
  // stamp "Page X of Y" on every buffered page before finalizing the doc.
  stampPageNumbers(doc);

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve({ fileId, filename }));
    stream.on('error', reject);
  });
}

module.exports = { generatePdf, getPdfPath, cleanupOldPdfs, generateReportSummaryPdf, sanitiseForPdf, formatMarkStr, formatGradeLabel };
