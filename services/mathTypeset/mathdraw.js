'use strict';

const FONTS = { body: 'Helvetica' };

function measureFraction(doc, fontSize, whole, num, den, font) {
  font = font || FONTS.body;
  const fracSize = Math.round(fontSize * 0.62);
  doc.font(font).fontSize(fracSize);
  const numW = doc.widthOfString(num);
  const denW = doc.widthOfString(den);
  const barW = Math.max(numW, denW) + 4;
  doc.font(font).fontSize(fontSize);
  const wholeW = whole ? doc.widthOfString(whole + ' ') : 0;
  const pad = 3;
  return { totalWidth: wholeW + barW + pad, wholeW, barW, fracSize, numW, denW };
}

function drawFraction(doc, x, y, fontSize, whole, num, den, color, font) {
  font = font || FONTS.body;
  const m = measureFraction(doc, fontSize, whole, num, den, font);
  let cx = x;

  if (whole) {
    doc.font(font).fontSize(fontSize).fillColor(color)
       .text(whole, cx, y, { lineBreak: false });
    cx += m.wholeW;
  }

  const barCenterY = y + fontSize * 0.42;
  const numY = barCenterY - m.fracSize * 0.98;
  const denY = barCenterY + m.fracSize * 0.18;

  doc.font(font).fontSize(m.fracSize).fillColor(color)
     .text(num, cx + (m.barW - m.numW) / 2, numY, { lineBreak: false });
  doc.font(font).fontSize(m.fracSize).fillColor(color)
     .text(den, cx + (m.barW - m.denW) / 2, denY, { lineBreak: false });

  doc.moveTo(cx, barCenterY).lineTo(cx + m.barW, barCenterY)
     .lineWidth(0.6).strokeColor(color).stroke();

  return x + m.totalWidth;
}

function measureExponent(doc, fontSize, base, exp, font) {
  font = font || FONTS.body;
  doc.font(font).fontSize(fontSize);
  const baseW = base ? doc.widthOfString(base) : 0;
  const expSize = Math.round(fontSize * 0.62);
  doc.font(font).fontSize(expSize);
  const expW = doc.widthOfString(exp);
  return { totalWidth: baseW + expW + 1, baseW, expSize, expW };
}

function drawExponent(doc, x, y, fontSize, base, exp, color, font) {
  font = font || FONTS.body;
  const m = measureExponent(doc, fontSize, base, exp, font);
  if (base) {
    doc.font(font).fontSize(fontSize).fillColor(color)
       .text(base, x, y, { lineBreak: false });
  }
  doc.font(font).fontSize(m.expSize).fillColor(color)
     .text(exp, x + m.baseW + 1, y - fontSize * 0.32, { lineBreak: false });
  return x + m.totalWidth;
}

function measureSqrt(doc, fontSize, index, radicand, font) {
  font = font || FONTS.body;
  doc.font(font).fontSize(fontSize);
  const radW = doc.widthOfString(radicand);
  const tickW = fontSize * 0.55;
  const indexW = index ? fontSize * 0.32 : 0;
  const pad = 3;
  return { totalWidth: indexW + tickW + radW + pad * 2, radW, tickW, indexW };
}

function drawSqrt(doc, x, y, fontSize, index, radicand, color, font) {
  font = font || FONTS.body;
  const m = measureSqrt(doc, fontSize, index, radicand, font);
  let cx = x;

  const baseline = y + fontSize * 0.78;
  const topY = y - fontSize * 0.08;

  if (index) {
    doc.font(font).fontSize(Math.round(fontSize * 0.55)).fillColor(color)
       .text(index, cx, topY - fontSize * 0.28, { lineBreak: false });
    cx += m.indexW;
  }

  const tickX0 = cx;
  const tickXmid = cx + m.tickW * 0.35;
  const tickX1 = cx + m.tickW;
  doc.lineWidth(0.9).strokeColor(color)
     .moveTo(tickX0, baseline - fontSize * 0.28)
     .lineTo(tickXmid, baseline)
     .lineTo(tickX1, topY)
     .stroke();

  const barX0 = tickX1;
  const barX1 = barX0 + m.radW + 4;
  doc.moveTo(barX0, topY).lineTo(barX1, topY).lineWidth(0.9).strokeColor(color).stroke();

  doc.font(font).fontSize(fontSize).fillColor(color)
     .text(radicand, barX0 + 2, y, { lineBreak: false });

  return x + m.totalWidth;
}

module.exports = { drawFraction, drawExponent, drawSqrt, measureFraction, measureExponent, measureSqrt };
