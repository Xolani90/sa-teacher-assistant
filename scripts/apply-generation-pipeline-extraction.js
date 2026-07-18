// Run from repo root: node scripts/apply-generation-pipeline-extraction.js
const fs = require('fs');
const path = require('path');

const webhookPath = 'routes/webhook.js';
const worksheetFlowPath = 'flows/worksheetFlow.js';
const pipelinePath = 'core/generationPipeline.js';

let webhook = fs.readFileSync(webhookPath, 'utf-8');
const originalLength = webhook.length;

// ── Helper: given the index of a function's opening "{", find the index
// of its matching closing "}" via brace counting. Safe here because the
// function body has no unbalanced braces inside string/template literals
// (checked manually against the source).
function findMatchingBrace(source, openBraceIdx) {
  let depth = 1;
  let i = openBraceIdx + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) return -1;
  return i - 1; // index of the matching '}'
}

// Given the index of "function foo(" or "async function foo(", locate the
// opening "{" of its body, then the matching closing "}". Also locate the
// preceding "/**" JSDoc block if one immediately precedes it.
function extractFunctionBlock(source, fnSigStart) {
  const braceOpenIdx = source.indexOf('{', fnSigStart);
  if (braceOpenIdx === -1) return null;
  const braceCloseIdx = findMatchingBrace(source, braceOpenIdx);
  if (braceCloseIdx === -1) return null;

  // Look for a JSDoc block ending right before fnSigStart (allow blank lines/whitespace between).
  const between = source.slice(0, fnSigStart);
  const jsdocEndMatch = between.match(/\*\/\s*$/);
  let blockStart = fnSigStart;
  if (jsdocEndMatch) {
    const jsdocEndIdx = fnSigStart - (between.length - jsdocEndMatch.index) + jsdocEndMatch[0].length;
    const jsdocStartIdx = source.lastIndexOf('/**', fnSigStart);
    if (jsdocStartIdx !== -1) {
      // Confirm nothing but whitespace between jsdoc end and fnSigStart
      const gap = source.slice(jsdocStartIdx, fnSigStart);
      if (/\/\*\*[\s\S]*?\*\/\s*$/.test(gap)) {
        blockStart = jsdocStartIdx;
      }
    }
  }

  return {
    blockStart,
    blockEnd: braceCloseIdx + 1, // include closing brace
    bodyStart: braceOpenIdx + 1,
    bodyEnd: braceCloseIdx,
    fullBlock: source.slice(blockStart, braceCloseIdx + 1),
    body: source.slice(braceOpenIdx + 1, braceCloseIdx),
  };
}

// ── Step 1: extract processGeneration() ─────────────────────────────────────
const fnSigMarker = 'async function processGeneration(from, intent, originalText = null) {';
const fnSigStart = webhook.indexOf(fnSigMarker);
if (fnSigStart === -1) {
  console.error('FAILED: processGeneration() signature not found.');
  process.exit(1);
}
const generationFn = extractFunctionBlock(webhook, fnSigStart);
if (!generationFn) {
  console.error('FAILED: could not brace-match processGeneration() body.');
  process.exit(1);
}
const rawBody = generationFn.body;

// ── Step 2: extract buildPdfUrl and hasExplicitExplanationKeyword ──────────
const buildPdfUrlSigStart = webhook.indexOf('function buildPdfUrl(fileId) {');
if (buildPdfUrlSigStart === -1) {
  console.error('FAILED: buildPdfUrl() signature not found.');
  process.exit(1);
}
const buildPdfUrlFn = extractFunctionBlock(webhook, buildPdfUrlSigStart);
if (!buildPdfUrlFn) {
  console.error('FAILED: could not brace-match buildPdfUrl() body.');
  process.exit(1);
}

const hasExplicitSigStart = webhook.indexOf('function hasExplicitExplanationKeyword(text) {');
if (hasExplicitSigStart === -1) {
  console.error('FAILED: hasExplicitExplanationKeyword() signature not found.');
  process.exit(1);
}
const hasExplicitFn = extractFunctionBlock(webhook, hasExplicitSigStart);
if (!hasExplicitFn) {
  console.error('FAILED: could not brace-match hasExplicitExplanationKeyword() body.');
  process.exit(1);
}

// ── Step 3: build core/generationPipeline.js ────────────────────────────────
const newSignature =
`async function triggerGeneration({ from, intent, originalText = null, deps }) {
  const {
    buildPrompt,
    generateContent,
    generatePdf,
    gradeLabel,
    getWorksheetTotalMarks,
    intentLabel,
    sendDocument,
    safeSendMessage,
    hashPhone,
    getTeacherByPhone,
    isProActive,
    checkAndIncrementUsage,
    rollbackUsage,
    isAiRateLimited,
    FREE_LIMIT_DISPLAY,
    pendingIntentState,
    lastGeneratedState,
  } = deps;
`;

const pipelineFileContent =
`// core/generationPipeline.js
// Extracted from routes/webhook.js — the shared AI generation pipeline
// (processGeneration -> triggerGeneration). Handles rate limiting, Pro
// gating for atp/moderationPack, quota deduction, prompt building, AI
// generation, ATP week-range validation/retry, delivery, PDF attachment,
// disambiguation/quiz/SAVE follow-ups, and resource-persistence state
// publication. Dependencies injected via buildGenerationDeps() in
// webhook.js; no reverse dependency on webhook.js.
//
// See docs/adr/ADR-002-generation-pipeline.md and
// docs/adr/generation-pipeline-analysis.md for the extraction boundary
// and dependency-contract evidence this module was built against.

'use strict';

const { validateAtpWeeks } = require('../utils/atpWeekValidator');

${buildPdfUrlFn.fullBlock}

${hasExplicitFn.fullBlock}

${newSignature}${rawBody}}

module.exports = { triggerGeneration };
`;

fs.mkdirSync(path.dirname(pipelinePath), { recursive: true });
fs.writeFileSync(pipelinePath, pipelineFileContent);
console.log('Wrote ' + pipelinePath + ' (' + pipelineFileContent.length + ' chars)');

// ── Step 4: remove all three extracted blocks from webhook.js ──────────────
// Remove in descending order of start index so earlier indices stay valid.
const blocksToRemove = [generationFn, buildPdfUrlFn, hasExplicitFn]
  .sort((a, b) => b.blockStart - a.blockStart);

// Also strip the "Process content generation" section divider comment
// immediately preceding processGeneration's JSDoc, if present.
const sectionDividerMarker = '// ── Process content generation ────────────────────────────────────────';
let genBlockStart = generationFn.blockStart;
const dividerIdx = webhook.lastIndexOf(sectionDividerMarker, genBlockStart);
if (dividerIdx !== -1 && webhook.slice(dividerIdx + sectionDividerMarker.length, genBlockStart).trim() === '') {
  genBlockStart = dividerIdx;
}

for (const block of blocksToRemove) {
  const start = block === generationFn ? genBlockStart : block.blockStart;
  webhook = webhook.slice(0, start) + webhook.slice(block.blockEnd);
}

// ── Step 5: add require + buildGenerationDeps() to webhook.js ──────────────
const depsAnchor = 'function buildAssessmentDeps() {';
const depsAnchorIdx = webhook.indexOf(depsAnchor);
if (depsAnchorIdx === -1) {
  console.error('FAILED: buildAssessmentDeps() anchor not found — aborting.');
  process.exit(1);
}

const generationDepsInsertion =
`// ── Generation pipeline module (extracted from this file) ──────────────────
const { triggerGeneration } = require('../core/generationPipeline');

function buildGenerationDeps() {
  return Object.freeze({
    buildPrompt,
    generateContent,
    generatePdf,
    gradeLabel,
    getWorksheetTotalMarks,
    intentLabel,
    sendDocument,
    safeSendMessage,
    hashPhone,
    getTeacherByPhone,
    isProActive,
    checkAndIncrementUsage,
    rollbackUsage,
    isAiRateLimited,
    FREE_LIMIT_DISPLAY,
    pendingIntentState,
    lastGeneratedState,
  });
}

`;

webhook = webhook.slice(0, depsAnchorIdx) + generationDepsInsertion + webhook.slice(depsAnchorIdx);

// ── Step 6: rewrite the six call sites ──────────────────────────────────────
let callSiteCount = 0;

webhook = webhook.replace(
  /await processGeneration\(from, lastIntent\);/g,
  () => { callSiteCount++; return 'await triggerGeneration({ from, intent: lastIntent, deps: buildGenerationDeps() });'; }
);

webhook = webhook.replace(
  /await processGeneration\(from, intent\);/g,
  () => { callSiteCount++; return 'await triggerGeneration({ from, intent, deps: buildGenerationDeps() });'; }
);

webhook = webhook.replace(
  /await processGeneration\(from, clarifiedIntent\);/g,
  () => { callSiteCount++; return 'await triggerGeneration({ from, intent: clarifiedIntent, deps: buildGenerationDeps() });'; }
);

webhook = webhook.replace(
  /await processGeneration\(from, intent, text\);/g,
  () => { callSiteCount++; return 'await triggerGeneration({ from, intent, originalText: text, deps: buildGenerationDeps() });'; }
);

console.log(`Updated ${callSiteCount} call site(s) (expected 6).`);

fs.writeFileSync(webhookPath, webhook);
console.log('Applied generation pipeline extraction to webhook.js.');
console.log('Length before:', originalLength, 'after:', webhook.length);

// ── Step 7: update flows/worksheetFlow.js ───────────────────────────────────
let worksheetFlow = fs.readFileSync(worksheetFlowPath, 'utf-8');

const oldJsdocFragment = '*   triggerGeneration,    // async (from, intent) => void — currently processGeneration(),';
if (worksheetFlow.indexOf(oldJsdocFragment) === -1) {
  console.error('WARNING: worksheetFlow.js JSDoc line not found by fragment match — leaving JSDoc unchanged.');
} else {
  // Replace the two-line JSDoc pair regardless of exact trailing dash/comment text.
  worksheetFlow = worksheetFlow.replace(
    / \*   triggerGeneration,.*\n \*.*will point at core\/generationPipeline\.js once it exists\n/,
    ' *   triggerGeneration,    // async ({ from, intent, originalText, deps }) => void\n *                         // — core/generationPipeline.js\n'
  );
  console.log('Updated worksheetFlow.js JSDoc.');
}

const oldCallSite = 'await triggerGeneration(from, intent);';
const newCallSite = 'await triggerGeneration({ from, intent, deps });';

if (worksheetFlow.indexOf(oldCallSite) === -1) {
  console.error('FAILED: worksheetFlow.js triggerGeneration call site not found — aborting.');
  process.exit(1);
}
worksheetFlow = worksheetFlow.replace(oldCallSite, newCallSite);

fs.writeFileSync(worksheetFlowPath, worksheetFlow);
console.log('Applied triggerGeneration object-parameter update to worksheetFlow.js.');
