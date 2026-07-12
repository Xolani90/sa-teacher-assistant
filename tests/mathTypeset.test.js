'use strict';

/**
 * Test suite for services/mathTypeset — the inline math tokenizer and
 * word-wrap layout engine used to render true fractions/exponents/roots
 * (not plain-text "12/18" approximations) in generated PDFs.
 * Run with: node tests/mathTypeset.test.js
 */

const { tokenizeMath } = require('../services/mathTypeset/tokenize');
const { buildAtoms, layoutAtoms } = require('../services/mathTypeset/richtext');

let passed = 0;
let failed = 0;

function assertDeepEqual(actual, expected, testName) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    console.log('     got:     ', JSON.stringify(actual));
    console.log('     expected:', JSON.stringify(expected));
    failed++;
  }
}

function assert(condition, testName) {
  if (condition) { console.log(`  ✅ PASS: ${testName}`); passed++; }
  else { console.log(`  ❌ FAIL: ${testName}`); failed++; }
}

console.log('📋 TEST 1: tokenizeMath — LaTeX notation');
assertDeepEqual(tokenizeMath('$\\frac{5}{8}$'),
  [{ type: 'text', value: '$' }, { type: 'frac', whole: null, num: '5', den: '8' }, { type: 'text', value: '$' }],
  'strips $ delimiters, converts \\frac');
assertDeepEqual(tokenizeMath('3\\frac{2}{7}'),
  [{ type: 'frac', whole: '3', num: '2', den: '7' }], 'mixed number via leading digit + \\frac');
assertDeepEqual(tokenizeMath('\\sqrt{144}'),
  [{ type: 'sqrt', index: null, radicand: '144' }], '\\sqrt{}');
assertDeepEqual(tokenizeMath('\\sqrt[3]{27}'),
  [{ type: 'sqrt', index: '3', radicand: '27' }], '\\sqrt[n]{} cube root');

console.log('\n📋 TEST 2: tokenizeMath — Unicode glyph notation');
assertDeepEqual(tokenizeMath('¹²⁄₁₈'),
  [{ type: 'frac', whole: null, num: '12', den: '18' }], 'superscript/subscript fraction');
assertDeepEqual(tokenizeMath('2³⁄₄'),
  [{ type: 'frac', whole: '2', num: '3', den: '4' }], 'mixed number, unicode');
assertDeepEqual(tokenizeMath('√144'),
  [{ type: 'sqrt', index: null, radicand: '144' }], 'unicode radical sign');
assertDeepEqual(tokenizeMath('∛27'),
  [{ type: 'sqrt', index: '3', radicand: '27' }], 'unicode cube-root sign');

console.log('\n📋 TEST 3: tokenizeMath — plain ASCII notation');
assertDeepEqual(tokenizeMath('12/18'), [{ type: 'frac', whole: null, num: '12', den: '18' }], 'bare a/b');
assertDeepEqual(tokenizeMath('2 3/4'), [{ type: 'frac', whole: '2', num: '3', den: '4' }], 'mixed a b/c');
assertDeepEqual(tokenizeMath('5^2'), [{ type: 'exp', base: '5', exp: '2' }], 'exponent');
assertDeepEqual(tokenizeMath('sqrt(144)'), [{ type: 'sqrt', index: null, radicand: '144' }], 'sqrt() function form');
assertDeepEqual(tokenizeMath('cbrt(27)'), [{ type: 'sqrt', index: '3', radicand: '27' }], 'cbrt() function form');

console.log('\n📋 TEST 4: tokenizeMath — false-positive guards');
assertDeepEqual(tokenizeMath('2026/07/11'), [{ type: 'text', value: '2026/07/11' }],
  'date-like triplet is NOT tokenized as a fraction');
assertDeepEqual(tokenizeMath('Page 1 of 5'), [{ type: 'text', value: 'Page 1 of 5' }],
  'page reference with no slash stays plain text');

console.log('\n📋 TEST 5: tokenizeMath — math embedded in a sentence, punctuation-adjacent');
assertDeepEqual(tokenizeMath('Thabo has 2 3/4 metres of rope.'), [
  { type: 'text', value: 'Thabo has ' },
  { type: 'frac', whole: '2', num: '3', den: '4' },
  { type: 'text', value: ' metres of rope.' },
], 'mixed number inline mid-sentence');
assertDeepEqual(tokenizeMath('the answer is 5/8.'), [
  { type: 'text', value: 'the answer is ' },
  { type: 'frac', whole: null, num: '5', den: '8' },
  { type: 'text', value: '.' },
], 'trailing period directly after fraction, no space swallowed');

console.log('\n📋 TEST 6: buildAtoms — bold-span propagation');
{
  const atoms = buildAtoms('A *bold* word and 1/2 a fraction.');
  const boldAtoms = atoms.filter((a) => a.bold);
  assert(boldAtoms.length === 1 && boldAtoms[0].value === 'bold', 'exactly one bold atom, correct text');
  const fracAtom = atoms.find((a) => a.type === 'frac');
  assert(!!fracAtom && fracAtom.num === '1' && fracAtom.den === '2' && !fracAtom.bold,
    'fraction atom present, not bold (outside the *bold* span)');
}

console.log('\n📋 TEST 7: layoutAtoms — word-wrap correctness (dry run, no PDFKit doc side effects on text)');
{
  // A minimal fake "doc" that mimics just enough of the PDFKit surface for
  // layoutAtoms/measure* to run without needing a real PDFDocument.
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 50 });
  doc.font('Helvetica').fontSize(10);

  const shortLine = 'Short line, one fraction 1/2 here.';
  const atoms = buildAtoms(shortLine);
  const endY = layoutAtoms(doc, atoms, { x: 50, y: 100, width: 495, fontSize: 10, color: 'black', dryRun: true });
  const lineHeight = doc.currentLineHeight(true) + 2;
  assert(Math.abs(endY - (100 + lineHeight)) < 0.01, 'single short line consumes exactly one line height');

  const longLine = 'This sentence is deliberately long enough with a fraction 3/4 in the middle that it must wrap onto a second physical line inside a normal body-text column width for a generated CAPS test paper.';
  const longAtoms = buildAtoms(longLine);
  const endY2 = layoutAtoms(doc, longAtoms, { x: 50, y: 100, width: 495, fontSize: 10, color: 'black', dryRun: true });
  assert(endY2 - 100 > lineHeight * 1.5, 'long line with embedded fraction wraps to more than one physical line');
}

console.log('\n─────────────────────────────────');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total:  ${passed + failed}`);
console.log('─────────────────────────────────');

process.exit(failed > 0 ? 1 : 0);
