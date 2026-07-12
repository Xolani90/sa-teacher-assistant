'use strict';

const SUPERSCRIPT_DIGITS = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
const SUBSCRIPT_DIGITS   = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const SUPER_CHARS = Object.keys(SUPERSCRIPT_DIGITS).join('');
const SUB_CHARS   = Object.keys(SUBSCRIPT_DIGITS).join('');
const supToDigits = (s) => s.split('').map((c) => SUPERSCRIPT_DIGITS[c] || c).join('');
const subToDigits = (s) => s.split('').map((c) => SUBSCRIPT_DIGITS[c] || c).join('');

// Ordered by priority: when multiple patterns match at the same position,
// the first one listed wins (e.g. mixed-number fraction before bare fraction,
// so "2 3/4" isn't tokenized as the word "2" plus a bare "3/4").
const PATTERNS = [
  { name: 'latexFrac', re: /(\d+)?\\(?:d|t)?frac\{([^{}]*)\}\{([^{}]*)\}/,
    build: (m) => ({ type: 'frac', whole: m[1] || null, num: m[2], den: m[3] }) },
  { name: 'latexSqrt', re: /\\sqrt(?:\[(\d+)\])?\{([^{}]*)\}/,
    build: (m) => ({ type: 'sqrt', index: m[1] || null, radicand: m[2] }) },
  { name: 'uniFrac', re: new RegExp(`(\\d+)?([${SUPER_CHARS}]+)\u2044([${SUB_CHARS}0-9]+)`),
    build: (m) => ({ type: 'frac', whole: m[1] || null, num: supToDigits(m[2]), den: subToDigits(m[3]) }) },
  { name: 'uniSqrt', re: /([²³⁴])?[√∛∜]\(?(\d+(?:\.\d+)?)\)?/,
    build: (m) => {
      let index = null;
      if (m[1]) index = supToDigits(m[1]);
      else if (m[0].startsWith('∛')) index = '3';
      else if (m[0].startsWith('∜')) index = '4';
      return { type: 'sqrt', index, radicand: m[2] };
    } },
  { name: 'asciiSqrtFn', re: /(sqrt|cbrt)\(([^()]*)\)/i,
    build: (m) => ({ type: 'sqrt', index: /cbrt/i.test(m[1]) ? '3' : null, radicand: m[2] }) },
  { name: 'asciiMixedFrac', re: /(?<![\d/])(\d{1,2}) (\d{1,3})\/(\d{1,3})(?![\d/])/,
    build: (m) => ({ type: 'frac', whole: m[1], num: m[2], den: m[3] }) },
  { name: 'asciiFrac', re: /(?<![\d/])(\d{1,3})\/(\d{1,3})(?![\d/])/,
    build: (m) => ({ type: 'frac', whole: null, num: m[1], den: m[2] }) },
  { name: 'asciiExp', re: /(\d+(?:\.\d+)?)\^(\d+)/,
    build: (m) => ({ type: 'exp', base: m[1], exp: m[2] }) },
];

function tokenizeMath(text) {
  const tokens = [];
  let pos = 0;
  while (pos < text.length) {
    let best = null;
    let bestPriority = Infinity;
    for (let i = 0; i < PATTERNS.length; i++) {
      const p = PATTERNS[i];
      const m = p.re.exec(text.slice(pos));
      if (m && (best === null || m.index < best.index || (m.index === best.index && i < bestPriority))) {
        best = { p, m, index: m.index };
        bestPriority = i;
      }
    }
    if (!best) {
      tokens.push({ type: 'text', value: text.slice(pos) });
      break;
    }
    if (best.index > 0) tokens.push({ type: 'text', value: text.slice(pos, pos + best.index) });
    tokens.push(best.p.build(best.m));
    pos += best.index + best.m[0].length;
  }
  return tokens;
}

module.exports = { tokenizeMath };
