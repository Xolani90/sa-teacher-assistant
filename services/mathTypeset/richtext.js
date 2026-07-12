'use strict';
const { tokenizeMath } = require('./tokenize.js');
const { drawFraction, drawExponent, drawSqrt, measureFraction, measureExponent, measureSqrt } = require('./mathdraw.js');

const FONTS = { body: 'Helvetica', heading: 'Helvetica-Bold' };

/**
 * Splits a line into a flat, ordered list of atoms: {type:'word'|'space',
 * value, bold} or {type:'frac'|'exp'|'sqrt', ..., bold}. This is the single
 * source of truth both the height-measuring pass and the drawing pass walk,
 * so they can never disagree about where lines wrap.
 */
function buildAtoms(line) {
  // Bold spans first (existing *text* convention), same as renderInlineBold.
  const boldParts = line.split(/(\*[^*]+\*)/).filter((p) => p !== '');
  const atoms = [];
  for (const part of boldParts) {
    const isBold = /^\*[^*]+\*$/.test(part);
    const text = isBold ? part.replace(/\*/g, '') : part;
    const mathTokens = tokenizeMath(text);
    for (const tok of mathTokens) {
      if (tok.type === 'text') {
        const pieces = tok.value.match(/\S+|\s+/g) || [];
        for (const piece of pieces) {
          if (/^\s+$/.test(piece)) atoms.push({ type: 'space', value: piece, bold: isBold });
          else atoms.push({ type: 'word', value: piece, bold: isBold });
        }
      } else {
        atoms.push({ ...tok, bold: isBold });
      }
    }
  }
  return atoms;
}

function measureAtomWidth(doc, atom, fontSize) {
  const font = atom.bold ? FONTS.heading : FONTS.body;
  if (atom.type === 'word') {
    doc.font(font).fontSize(fontSize);
    return doc.widthOfString(atom.value);
  }
  if (atom.type === 'space') {
    doc.font(font).fontSize(fontSize);
    return doc.widthOfString(atom.value);
  }
  if (atom.type === 'frac') return measureFraction(doc, fontSize, atom.whole, atom.num, atom.den, font).totalWidth;
  if (atom.type === 'exp') return measureExponent(doc, fontSize, atom.base, atom.exp, font).totalWidth;
  if (atom.type === 'sqrt') return measureSqrt(doc, fontSize, atom.index, atom.radicand, font).totalWidth;
  return 0;
}

function drawAtomAt(doc, atom, x, y, fontSize, color) {
  const font = atom.bold ? FONTS.heading : FONTS.body;
  if (atom.type === 'word') {
    doc.font(font).fontSize(fontSize).fillColor(color).text(atom.value, x, y, { lineBreak: false });
    return;
  }
  if (atom.type === 'frac') { drawFraction(doc, x, y, fontSize, atom.whole, atom.num, atom.den, color, font); return; }
  if (atom.type === 'exp') { drawExponent(doc, x, y, fontSize, atom.base, atom.exp, color, font); return; }
  if (atom.type === 'sqrt') { drawSqrt(doc, x, y, fontSize, atom.index, atom.radicand, color, font); return; }
}

/**
 * Lays out atoms with greedy word-wrap inside [x, x+width], drawing them
 * unless dryRun is true (in which case it only computes final height — used
 * for pagination checks before committing to draw).
 * Returns the y position immediately after the last line drawn.
 */
function layoutAtoms(doc, atoms, { x, y, width, fontSize, color, dryRun = false, extraLineGap = 2 }) {
  const leftEdge = x;
  const rightEdge = x + width;
  const lineHeight = doc.currentLineHeight(true) + extraLineGap;
  let cx = leftEdge;
  let cy = y;
  let atLineStart = true;
  let pendingSpaceWidth = 0;

  for (const atom of atoms) {
    if (atom.type === 'space') {
      pendingSpaceWidth = measureAtomWidth(doc, atom, fontSize);
      continue;
    }
    const w = measureAtomWidth(doc, atom, fontSize);
    const extra = atLineStart ? 0 : pendingSpaceWidth;
    if (!atLineStart && cx + extra + w > rightEdge) {
      cx = leftEdge;
      cy += lineHeight;
      atLineStart = true;
    }
    const drawX = cx + (atLineStart ? 0 : pendingSpaceWidth);
    if (!dryRun) drawAtomAt(doc, atom, drawX, cy, fontSize, color);
    cx = drawX + w;
    atLineStart = false;
    pendingSpaceWidth = 0;
  }

  return cy + lineHeight;
}

function measureLineHeight(doc, line, { width, fontSize }) {
  const atoms = buildAtoms(line);
  const startY = 0;
  const endY = layoutAtoms(doc, atoms, { x: 0, y: startY, width, fontSize, color: 'black', dryRun: true });
  return endY - startY;
}

function renderRichLine(doc, line, { x, width, fontSize, color }) {
  const atoms = buildAtoms(line);
  const endY = layoutAtoms(doc, atoms, { x, y: doc.y, width, fontSize, color, dryRun: false });
  doc.y = endY;
}

module.exports = { buildAtoms, layoutAtoms, measureLineHeight, renderRichLine };
