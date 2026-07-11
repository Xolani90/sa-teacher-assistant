'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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
};
function sanitiseForPdf(input) {
  if (typeof input !== 'string') return input;
  let out = input;
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
function drawHeader(doc, { title, grade, subject, school, date } = {}) {
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
    .text(school || 'SA Teacher Assistant', margin, 14, { width: pageWidth - margin * 2, lineBreak: false });

  // Document title (bold, centered)
  doc
    .font(FONTS.heading)
    .fontSize(16)
    .fillColor(COLORS.white)
    .text(title || '', margin, 28, { width: pageWidth - margin * 2, align: 'center', lineBreak: false });

  // Subtitle row: Subject | Grade | Date
  const subtitle = [subject, grade, date || new Date().toLocaleDateString('en-ZA')].filter(Boolean).join('  |  ');
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
 * Draws the student info row (Name / Class / Date / Total).
 *
 * @param {PDFDocument} doc
 * @param {number} totalMarks
 */
function drawStudentInfoRow(doc, totalMarks) {
  const margin = 50;
  const y      = doc.y + 8;
  const w      = (doc.page.width - margin * 2) / 4;

  doc.font(FONTS.body).fontSize(10).fillColor(COLORS.darkText);

  const fields = [
    { label: 'Name:', underlineWidth: w - 40 },
    { label: 'Class:', underlineWidth: w - 40 },
    { label: 'Date:', underlineWidth: w - 40 },
    { label: `Total: ___/${totalMarks || ''}`, underlineWidth: 0 },
  ];

  fields.forEach((field, i) => {
    const x = margin + i * w;
    doc.text(field.label, x, y);
    if (field.underlineWidth > 0) {
      doc.moveTo(x + 40, y + 12).lineTo(x + 40 + field.underlineWidth, y + 12).stroke(COLORS.midGray);
    }
  });

  doc.y = y + 24;
  doc.moveTo(margin, doc.y).lineTo(doc.page.width - margin, doc.y).stroke(COLORS.border);
  doc.y += 10;
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

  doc
    .font(FONTS.body)
    .fontSize(8)
    .fillColor(COLORS.midGray)
    .text('Generated by SA Teacher Assistant — CAPS Aligned', 50, y + 6, { align: 'left', lineBreak: false })
    .text(`Page ${doc.bufferedPageRange().start + 1}`, 50, y + 6, { align: 'right', width: pageWidth - 100, lineBreak: false });

  doc.page.margins.bottom = savedBottom;
  doc.y = savedY; // Restore cursor — never let footer position bleed into content
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
      // Estimate height for pagination check (single line of 10pt body text)
      doc.font(FONTS.body).fontSize(10);
      const estimatedH = doc.heightOfString(line.replace(/\*/g, ''), { width: bodyWidth }) + 8;
      ensureSpace(doc, estimatedH);
      renderInlineBold(doc, line, margin, bodyWidth);
      doc.y += 2;
      continue;
    }

    // Bullet point: • or -
    if (line.startsWith('•') || (line.startsWith('-') && line.length > 2)) {
      const bulletText = line.replace(/^[•\-]\s*/, '');
      doc.font(FONTS.body).fontSize(10);
      const estimatedH = doc.heightOfString(bulletText, { width: bodyWidth - 20 }) + 6;
      ensureSpace(doc, estimatedH);
      doc
        .font(FONTS.body).fontSize(10).fillColor(COLORS.darkText)
        .text('•', margin + 4, doc.y, { continued: false, width: 12 });
      doc
        .font(FONTS.body).fontSize(10).fillColor(COLORS.darkText)
        .text(bulletText, margin + 20, doc.y - doc.currentLineHeight(true), { width: bodyWidth - 20 });
      doc.y += 2;
      continue;
    }

    // Numbered list: 1. text
    if (/^\d{1,2}[.)]\s/.test(line)) {
      const numMatch = line.match(/^(\d{1,2}[.)]\s)(.*)/);
      if (numMatch) {
        doc.font(FONTS.body).fontSize(10);
        const estimatedH = doc.heightOfString(numMatch[2], { width: bodyWidth - 24 }) + 6;
        ensureSpace(doc, estimatedH);
        doc
          .font(FONTS.heading).fontSize(10).fillColor(COLORS.darkText)
          .text(numMatch[1], margin + 4, doc.y, { continued: false, width: 20 });
        doc
          .font(FONTS.body).fontSize(10).fillColor(COLORS.darkText)
          .text(numMatch[2], margin + 24, doc.y - doc.currentLineHeight(true), { width: bodyWidth - 24 });
        doc.y += 3;
        continue;
      }
    }

    // Mark allocation (trailing parenthetical marks): (1), (2), (3)
    if (/\(\d+\)$/.test(line)) {
      const marksMatch = line.match(/(.*?)\s*(\(\d+\))$/);
      if (marksMatch) {
        doc.font(FONTS.body).fontSize(10);
        const estimatedH = doc.heightOfString(marksMatch[1], { width: bodyWidth - 40 }) + 6;
        ensureSpace(doc, estimatedH);
        doc
          .font(FONTS.body).fontSize(10).fillColor(COLORS.darkText)
          .text(marksMatch[1], margin, doc.y, { continued: true, width: bodyWidth - 40 });
        doc
          .font(FONTS.heading).fontSize(10).fillColor(COLORS.accent)
          .text(marksMatch[2], { align: 'right' });
        doc.y += 2;
        continue;
      }
    }

    // Answer lines (blank lines for writing)
    if (line.startsWith('Answer:') || line.startsWith('Working:')) {
      ensureSpace(doc, 30);
      doc
        .font(FONTS.italic).fontSize(10).fillColor(COLORS.midGray)
        .text(line, margin, doc.y, { width: bodyWidth });
      doc.y += 16; // Extra space for student to write
      continue;
    }

    // Empty line — add spacing
    if (line === '') {
      doc.y += 6;
      continue;
    }

    // Default: normal body text
    // PDFKit's text() with no explicit height/ellipsis DOES auto-paginate on
    // wrap, so for multi-line paragraphs we just need a minimal guard to
    // ensure at least one line fits before we start (avoids orphan single-line
    // draws right at the bottom margin boundary).
    doc.font(FONTS.body).fontSize(10);
    const lineH = doc.currentLineHeight(true);
    ensureSpace(doc, lineH + 2);
    doc
      .font(FONTS.body).fontSize(10).fillColor(COLORS.darkText)
      .text(line, margin, doc.y, { width: bodyWidth });
    doc.y += 2;
  }
}

/**
 * Renders a line that contains mixed *bold* and normal text inline.
 *
 * @param {PDFDocument} doc
 * @param {string} line
 * @param {number} margin
 * @param {number} width
 */
function renderInlineBold(doc, line, margin, width) {
  const parts = line.split(/(\*[^*]+\*)/);
  // Find the index of the last non-empty part so `continued` is false only on
  // the actual final visible segment. Using `parts.length - 1` is wrong when
  // there are trailing empty strings (common when the line ends with a *bold*
  // segment), because the empty part gets skipped but the prior part still has
  // `continued: false` applied — except the empty parts after it would not be
  // the last segment rendered, leaving PDFKit in a "continued text" state that
  // bleeds into the next doc.text() call on the page.
  const lastNonEmpty = parts.reduce((last, p, i) => (p ? i : last), -1);
  let x = margin;
  const y = doc.y;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    const isLast = i === lastNonEmpty;

    if (/^\*[^*]+\*$/.test(part)) {
      // Bold segment
      doc.font(FONTS.heading).fontSize(10).fillColor(COLORS.darkText)
         .text(part.replace(/\*/g, ''), x, y, { continued: !isLast, width: width - (x - margin) });
    } else {
      doc.font(FONTS.body).fontSize(10).fillColor(COLORS.darkText)
         .text(part, x, y, { continued: !isLast, width: width - (x - margin) });
    }
    x = null; // Let PDFKit continue from current position after first segment
  }

  doc.y += 4;
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
async function generatePdf({ content, type, topic, grade, subject, school, marks }) {
  ensurePdfDir();

  // Normalize casing once here — content already comes back correctly
  // capitalized from the AI, but topic/grade/subject arrive as raw teacher
  // input (e.g. "fractions", "mathematics") and are used separately to
  // build the header/title/filename below.
  topic   = toTitleCase(topic);
  grade   = toTitleCase(grade);
  subject = toTitleCase(subject);

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

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 110, bottom: 60, left: 50, right: 50 },
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

    // Draw header on first page
    drawHeader(doc, { title, grade, subject, school, date: new Date().toLocaleDateString('en-ZA') });

    // Draw student info row for assessments
    if (type === 'worksheet' || type === 'test') {
      drawStudentInfoRow(doc, marks);
    }

    // Add header + footer to each new page
    doc.on('pageAdded', () => {
      drawHeader(doc, { title, grade, subject, school, date: new Date().toLocaleDateString('en-ZA') });
      drawFooter(doc, school);
    });

    // Draw footer on first page too
    drawFooter(doc, school);

    // Render the content
    renderFormattedText(doc, content);

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
  const gradeStr = grade != null ? String(grade) : '';
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
  const { grade, subject, school } = metadata;

  ensurePdfDir();

  const fileId = uuidv4(); // Use uuid for consistency (avoids collision)
  const filename = `Report_Comments_${grade || 'All'}_${subject || 'All'}.pdf`;
  const filePath = path.join(PDF_DIR, `${fileId}.pdf`); // FIX: was missing .pdf extension

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 110, bottom: 60, left: 50, right: 50 },
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
    const excerpt = (c.comment || '').substring(0, 80) + (c.comment && c.comment.length > 80 ? '…' : '');
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

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve({ fileId, filename }));
    stream.on('error', reject);
  });
}

module.exports = { generatePdf, getPdfPath, cleanupOldPdfs, generateReportSummaryPdf, sanitiseForPdf, formatMarkStr };
