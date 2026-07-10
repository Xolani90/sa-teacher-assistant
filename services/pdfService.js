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
 * @param {{ title, grade, subject, school, date, logoPath, showCapsBadge }} meta
 * @param {string} [meta.logoPath] - Absolute path to a school logo image (PNG/JPEG).
 *   Optional. If the file is missing, unreadable, or not a supported image format,
 *   the header falls back to text-only silently (logged, not thrown) — a bad or
 *   missing logo file must never crash PDF generation for the teacher.
 * @param {boolean} [meta.showCapsBadge=true] - Show the green "CAPS ALIGNED" pill
 *   badge top-right. Every document type from this app is CAPS-aligned, so this
 *   defaults on; pass false for the rare document that isn't (e.g. a raw utility export).
 */
function drawHeader(doc, { title, grade, subject, school, date, logoPath, showCapsBadge = true } = {}) {
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

  // School logo (top left, if provided). Drawn before the school name so we
  // know how far to indent the name text. A logo failure (missing file, bad
  // format, corrupt bytes) must degrade to text-only, not crash the whole
  // PDF — this is a teacher-facing document, not a place for a stack trace.
  let schoolNameX = margin;
  const logoSize = 40;
  if (logoPath) {
    try {
      doc.image(logoPath, margin, (80 - logoSize) / 2, { fit: [logoSize, logoSize] });
      schoolNameX = margin + logoSize + 10;
    } catch (err) {
      console.warn(`[PDF] Could not load school logo (${logoPath}), continuing without it:`, err.message);
    }
  }

  // School name (top left, white — shifted right if a logo was drawn)
  doc
    .font(FONTS.heading)
    .fontSize(9)
    .fillColor(COLORS.white)
    .text(school || 'SA Teacher Assistant', schoolNameX, 14, { width: pageWidth - margin - schoolNameX, lineBreak: false });

  // CAPS ALIGNED badge (top right, green pill)
  if (showCapsBadge) {
    const badgeText    = 'CAPS ALIGNED';
    const badgeH       = 18;
    const badgePadding = 10;
    doc.font(FONTS.heading).fontSize(8);
    const badgeW = doc.widthOfString(badgeText) + badgePadding * 2;
    const badgeX = pageWidth - margin - badgeW;
    const badgeY = 14;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, badgeH / 2).fill(COLORS.accent);
    doc
      .font(FONTS.heading).fontSize(8).fillColor(COLORS.white)
      .text(badgeText, badgeX, badgeY + 5, { width: badgeW, align: 'center', lineBreak: false });
  }

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
function drawSectionHeading(doc, heading, marks, extraHeight = 0) {
  const margin = 50;

  // Ensure enough room for the heading box (22pt) + top spacing (6pt) + bottom spacing (6pt),
  // PLUS extraHeight (an estimate of the next content line's height, if known). Without the
  // extra reservation, a heading can legally land as the very last thing on a page while its
  // own content gets pushed to the next page — an "orphan heading".
  ensureSpace(doc, 34 + extraHeight);

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
 * Draws the footer on each page (left-hand "Generated by..." text + rule only).
 * Called automatically via the `pageAdded` event, plus once for page 1.
 *
 * The page number ("Page X of Y") is deliberately NOT drawn here — at the
 * point any single page is created, the document doesn't yet know its final
 * page count. drawPageNumbers() below fills that in afterwards, once, in a
 * final pass over all buffered pages.
 *
 * @param {PDFDocument} doc
 * @param {string} [schoolName] - unused directly (kept for call-site symmetry
 *   with drawHeader) but reserved in case a school-specific footer note is
 *   ever needed.
 * @param {string} [date] - formatted date string, shared with drawHeader so
 *   the header and footer always show the same date even if generation
 *   happens to straddle midnight.
 */
function drawFooter(doc, schoolName, date) {
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

  const footerDate = date || new Date().toLocaleDateString('en-ZA');
  doc
    .font(FONTS.body)
    .fontSize(8)
    .fillColor(COLORS.midGray)
    .text(`Generated by SA Teacher Assistant — CAPS Aligned — ${footerDate}`, 50, y + 6, { align: 'left', lineBreak: false });

  doc.page.margins.bottom = savedBottom;
  doc.y = savedY; // Restore cursor — never let footer position bleed into content
}

/**
 * Writes "Page X of Y" to every buffered page, right-aligned in the footer.
 * Must be called AFTER all content has been rendered (so the final page
 * count is known) and BEFORE doc.end() (bufferPages must be true so pages
 * remain revisitable via switchToPage).
 *
 * @param {PDFDocument} doc
 */
function drawPageNumbers(doc) {
  const pageWidth = doc.page.width;
  const range = doc.bufferedPageRange(); // { start, count }

  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);

    const y = doc.page.height - 36;
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc
      .font(FONTS.body)
      .fontSize(8)
      .fillColor(COLORS.midGray)
      .text(`Page ${i + 1} of ${range.count}`, 50, y + 6, { align: 'right', width: pageWidth - 100, lineBreak: false });

    doc.page.margins.bottom = savedBottom;
  }
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
function drawTableHeaderRow(doc, cells, margin, bodyWidth, rowHeight) {
  const colCount = cells.length;
  const colWidth = bodyWidth / colCount;
  const rowY = doc.y;

  doc.rect(margin, rowY, bodyWidth, rowHeight).fill(COLORS.primary);

  cells.forEach((cell, i) => {
    doc.font(FONTS.heading)
       .fontSize(9)
       .fillColor(COLORS.white)
       .text(cell, margin + i * colWidth + 4, rowY + 4, {
         width: colWidth - 8,
         height: rowHeight - 4,
         ellipsis: true,
       });
  });

  doc.strokeColor(COLORS.border).lineWidth(0.5);
  for (let i = 1; i < colCount; i++) {
    doc.moveTo(margin + i * colWidth, rowY).lineTo(margin + i * colWidth, rowY + rowHeight).stroke();
  }
  doc.rect(margin, rowY, bodyWidth, rowHeight).stroke();

  doc.y = rowY + rowHeight + 1;
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

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const raw = lines[lineIdx];
    const line = raw.trim();

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

    // Section dividers (═══ or ---)
    if (/^[═=─-]{4,}$/.test(line)) {
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
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      const colCount = cells.length;
      if (colCount > 0) {
        const colWidth = bodyWidth / colCount;
        const isHeader = doc._atpTableHeader === undefined; // first row treated as header

        if (isHeader) {
          // Cache header cells for repeating on page breaks
          doc._atpTableHeader = true;
          doc._atpTableHeaderCells = cells;
          doc._atpRowCount = 0;

          // Ensure room for header row + at least one data row
          ensureSpace(doc, ROW_HEIGHT * 2);
          drawTableHeaderRow(doc, cells, margin, bodyWidth, ROW_HEIGHT);
          continue;
        }

        // Data row — check if it fits; if not, start new page and repeat header
        ensureSpace(doc, ROW_HEIGHT + 2);

        // If ensureSpace triggered a page break, doc.y is now at top-of-content.
        // Repeat the table header on the new page so the table is self-contained.
        if (doc._atpTableHeaderCells && doc.y < 130) {
          // doc.y < 130 means we just came from a fresh page (header sets y=100)
          drawTableHeaderRow(doc, doc._atpTableHeaderCells, margin, bodyWidth, ROW_HEIGHT);
          doc._atpRowCount = 0; // restart stripe pattern after repeated header
        }

        const rowY = doc.y;
        const rowBg = (doc._atpRowCount % 2 === 0) ? COLORS.lightGray : COLORS.white;

        // Row background
        doc.rect(margin, rowY, bodyWidth, ROW_HEIGHT).fill(rowBg);
        doc._atpRowCount++;

        // Cell text
        cells.forEach((cell, i) => {
          doc.font(FONTS.body)
             .fontSize(9)
             .fillColor(COLORS.darkText)
             .text(cell, margin + i * colWidth + 4, rowY + 4, {
               width: colWidth - 8,
               height: ROW_HEIGHT - 4,
               ellipsis: true,
             });
        });

        // Cell dividers
        doc.strokeColor(COLORS.border).lineWidth(0.5);
        for (let i = 1; i < colCount; i++) {
          doc.moveTo(margin + i * colWidth, rowY).lineTo(margin + i * colWidth, rowY + ROW_HEIGHT).stroke();
        }
        doc.rect(margin, rowY, bodyWidth, ROW_HEIGHT).stroke();

        doc.y = rowY + ROW_HEIGHT + 1;
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

      // Look ahead to the next non-empty line and estimate its rendered height, so the
      // heading's own ensureSpace() call reserves room for it too. This stops the heading
      // from being drawn as an orphan at the very bottom of a page while its content is
      // pushed onto the next page.
      let nextContentHeight = 0;
      for (let j = lineIdx + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine === '') continue;
        const plain = nextLine.replace(/^[•\-]\s*/, '').replace(/\*/g, '');
        doc.font(FONTS.body).fontSize(10);
        nextContentHeight = doc.heightOfString(plain, { width: bodyWidth }) + 8;
        break;
      }

      drawSectionHeading(doc, heading, undefined, nextContentHeight);
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
      // Height must be estimated from the PLAIN text (asterisks stripped) —
      // otherwise the literal '*' characters get counted into the wrap width,
      // which under-reserves vertical space whenever a bold span pushes a
      // word onto an extra line the estimate didn't account for.
      const plainForHeight = bulletText.replace(/\*/g, '');
      const estimatedH = doc.heightOfString(plainForHeight, { width: bodyWidth - 20 }) + 6;
      ensureSpace(doc, estimatedH);
      doc
        .font(FONTS.body).fontSize(10).fillColor(COLORS.darkText)
        .text('•', margin + 4, doc.y, { continued: false, width: 12 });
      const bulletY = doc.y - doc.currentLineHeight(true);
      if (bulletText.includes('*')) {
        renderInlineBoldAt(doc, bulletText, margin + 20, bodyWidth - 20, bulletY);
      } else {
        doc
          .font(FONTS.body).fontSize(10).fillColor(COLORS.darkText)
          .text(bulletText, margin + 20, bulletY, { width: bodyWidth - 20 });
      }
      doc.y += 2;
      continue;
    }

    // Numbered list: 1. text
    if (/^\d{1,2}[.)]\s/.test(line)) {
      const numMatch = line.match(/^(\d{1,2}[.)]\s)(.*)/);
      if (numMatch) {
        doc.font(FONTS.body).fontSize(10);
        const plainForHeight = numMatch[2].replace(/\*/g, '');
        const estimatedH = doc.heightOfString(plainForHeight, { width: bodyWidth - 24 }) + 6;
        ensureSpace(doc, estimatedH);
        doc
          .font(FONTS.heading).fontSize(10).fillColor(COLORS.darkText)
          .text(numMatch[1], margin + 4, doc.y, { continued: false, width: 20 });
        const itemY = doc.y - doc.currentLineHeight(true);
        if (numMatch[2].includes('*')) {
          renderInlineBoldAt(doc, numMatch[2], margin + 24, bodyWidth - 24, itemY);
        } else {
          doc
            .font(FONTS.body).fontSize(10).fillColor(COLORS.darkText)
            .text(numMatch[2], margin + 24, itemY, { width: bodyWidth - 24 });
        }
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
  renderInlineBoldAt(doc, line, margin, width, doc.y);
  doc.y += 4;
}

/**
 * Core bold-span renderer, factored out of renderInlineBold so that bullets
 * and numbered-list items can render *bold* spans at an indented x-offset
 * (margin + 20, margin + 24, etc.) instead of only at the page margin.
 *
 * Previously, the bullet and numbered-list branches wrote their text with
 * plain doc.text() and never called any bold parser at all — so any
 * bullet/numbered item containing a *bold* span (very common in AI output:
 * "• *Label:* rest of sentence") printed the literal asterisk characters
 * straight into the PDF instead of rendering bold text. Every caller that
 * needs bold-aware text now goes through here so the fix applies everywhere,
 * not just the one call site that happened to be checked first.
 *
 * @param {PDFDocument} doc
 * @param {string} line
 * @param {number} x - starting x position for this text block
 * @param {number} width - available width for this text block
 * @param {number} y - y position to draw at (caller controls this; this
 *   function does not read or mutate doc.y itself)
 */
function renderInlineBoldAt(doc, line, x, width, y) {
  const parts = line.split(/(\*[^*]+\*)/);
  // Find the index of the last non-empty part so `continued` is false only on
  // the actual final visible segment. Using `parts.length - 1` is wrong when
  // there are trailing empty strings (common when the line ends with a *bold*
  // segment), because the empty part gets skipped but the prior part still has
  // `continued: false` applied — except the empty parts after it would not be
  // the last segment rendered, leaving PDFKit in a "continued text" state that
  // bleeds into the next doc.text() call on the page.
  const lastNonEmpty = parts.reduce((last, p, i) => (p ? i : last), -1);

  // Root cause of the overlap/garbled-text bug: PDFKit's _initOptions() does
  // `if (y != null) { this.y = y; }` UNCONDITIONALLY on every .text() call —
  // it never checks x. The old code always passed the original (fixed) `y`
  // on every segment, even after curX was set to null. So if the FIRST
  // segment's own text was long enough to wrap onto a second line (common
  // with long *bold labels:*), the next segment's call would still pass the
  // old y and snap doc.y back to the first line, drawing directly on top of
  // the already-wrapped text. Confirmed via pdftotext -bbox: two segments
  // landing at overlapping y-coordinates with overlapping x-ranges.
  //
  // Fix: only the FIRST segment gets explicit x/y. Every segment after that
  // is called with no position arguments at all (options-only signature), so
  // PDFKit continues from wherever its internal cursor actually is -- wrap
  // or no wrap -- instead of being told to jump back to a stale position.
  let isFirstSegment = true;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    const isLast = i === lastNonEmpty;
    const textOptions = { continued: !isLast, width };

    if (/^\*[^*]+\*$/.test(part)) {
      // Bold segment
      doc.font(FONTS.heading).fontSize(10).fillColor(COLORS.darkText);
      if (isFirstSegment) {
        doc.text(part.replace(/\*/g, ''), x, y, textOptions);
      } else {
        doc.text(part.replace(/\*/g, ''), textOptions);
      }
    } else {
      doc.font(FONTS.body).fontSize(10).fillColor(COLORS.darkText);
      if (isFirstSegment) {
        doc.text(part, x, y, textOptions);
      } else {
        doc.text(part, textOptions);
      }
    }
    isFirstSegment = false;
  }
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
 * @param {string} [params.logoPath] - Absolute path to a school logo image
 *   (PNG/JPEG). Optional — falls back to text-only header if missing/invalid.
 * @returns {Promise<{ filePath: string, filename: string, fileId: string }>}
 */
async function generatePdf({ content, type, topic, grade, subject, school, marks, logoPath }) {
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
      bufferPages: true, // Required so drawPageNumbers() can revisit finished
                         // pages afterwards to write "Page X of Y" once the
                         // final page count is known.
      info: {
        Title:    title,
        Author:   'SA Teacher Assistant',
        Subject:  `${subject} — ${grade}`,
        Creator:  'SA Teacher Assistant v2',
        Keywords: 'CAPS, South Africa, education',
      },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Computed once and reused for every header/footer on every page, so the
    // date can never drift if generation happens to straddle midnight.
    const generatedDate = new Date().toLocaleDateString('en-ZA');

    // Draw header on first page
    drawHeader(doc, { title, grade, subject, school, date: generatedDate, logoPath });

    // Draw student info row for assessments
    if (type === 'worksheet' || type === 'test') {
      drawStudentInfoRow(doc, marks);
    }

    // Add header + footer to each new page
    doc.on('pageAdded', () => {
      drawHeader(doc, { title, grade, subject, school, date: generatedDate, logoPath });
      drawFooter(doc, school, generatedDate);
    });

    // Draw footer on first page too
    drawFooter(doc, school, generatedDate);

    // Render the content
    renderFormattedText(doc, content);

    // Final pass: now that the full page count is known, stamp "Page X of Y"
    // onto every page. Must happen before doc.end() while pages are still
    // revisitable (bufferPages: true above).
    drawPageNumbers(doc);

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

  const tableTop = doc.y;
  const tableLeft = 50;
  const colWidths = [120, 60, 335]; // Learner, Mark, Comment excerpt
  const rowHeight = 22;

  // Table header
  doc.font(FONTS.heading).fontSize(10).fillColor(COLORS.darkText);
  ['Learner', 'Mark', 'Comment (excerpt)'].forEach((h, i) => {
    doc.text(h, tableLeft + colWidths.slice(0, i).reduce((a, b) => a + b, 0), tableTop);
  });

  // Table rows — with pagination guard
  doc.font(FONTS.body).fontSize(10).fillColor(COLORS.darkText);
  comments.forEach((c, i) => {
    ensureSpace(doc, rowHeight + 4);
    const y = doc.y;
    const markStr = c.outOf ? `${c.mark}/${c.outOf}` : `${c.mark}%`;
    const excerpt = (c.comment || '').substring(0, 60) + (c.comment && c.comment.length > 60 ? '…' : '');

    doc.text(c.learnerName || '', tableLeft, y, { width: colWidths[0], ellipsis: true });
    doc.text(markStr, tableLeft + colWidths[0], y, { width: colWidths[1] });
    doc.text(excerpt, tableLeft + colWidths[0] + colWidths[1], y, { width: colWidths[2], ellipsis: true });
    doc.y = y + rowHeight;
  });

  doc.moveDown(2);

  // Full comments — one per page after the first
  doc.font(FONTS.heading).fontSize(12).fillColor(COLORS.darkText).text('Full Comments', { underline: true });
  doc.moveDown(0.5);

  comments.forEach((c, i) => {
    if (i > 0) {
      doc.addPage();
    }

    const markStr = c.outOf ? `${c.mark}/${c.outOf}` : `${c.mark}%`;

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

module.exports = { generatePdf, getPdfPath, cleanupOldPdfs, generateReportSummaryPdf };
