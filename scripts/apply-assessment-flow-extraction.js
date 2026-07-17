// Run from repo root: node scripts/apply-assessment-flow-extraction.js
const fs = require('fs');
const path = 'routes/webhook.js';
let content = fs.readFileSync(path, 'utf-8');
const originalLength = content.length;

// ── Step 1: extract the handleDataAssessmentFlow function body verbatim ──
const startMarker = 'async function handleDataAssessmentFlow(from, text, message = null, preClassifiedIntent = null) {';
const endMarker = '/**\n * Parses the AI intervention response into step sections.';
const endMarkerCRLF = '/**\r\n * Parses the AI intervention response into step sections.';

const startIdx = content.indexOf(startMarker);
let endIdx = content.indexOf(endMarker);
if (endIdx === -1) endIdx = content.indexOf(endMarkerCRLF);

if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  console.log(`WARNING: markers not found correctly. start=${startIdx} end=${endIdx} — aborting.`);
  process.exit(1);
}

const functionBlock = content.slice(startIdx, endIdx);

// ── Step 2: build the new flow module ──
const newSignature = 'async function handleAssessmentFlow(from, text, message = null, preClassifiedIntent = null, deps) {\n' +
  '  const {\n' +
  '    hashPhone,\n' +
  '    safeSendMessage,\n' +
  '    gradeLabel,\n' +
  '    isProActive,\n' +
  '    getTeacherByPhone,\n' +
  '    dataAssessmentState,\n' +
  '    parseMarks,\n' +
  '    extractMarksFromImage,\n' +
  '    getFormatHelpText,\n' +
  '    processAssessmentData,\n' +
  '  } = deps;\n\n';

const bodyWithoutOriginalSignature = functionBlock.slice(startMarker.length + 1); // skip signature line + newline
const newFunctionBlock = newSignature + bodyWithoutOriginalSignature;

const flowFileContent =
`// flows/assessmentFlow.js
// Extracted from routes/webhook.js — handles the "upload marks" multi-turn
// data-assessment flow (CSV / photo / document upload -> parse -> diagnostic
// summary via processAssessmentData()). Dependencies injected via
// buildAssessmentDeps() in webhook.js; no reverse dependency on webhook.js.

${newFunctionBlock.trimEnd()}

module.exports = { handleAssessmentFlow };
`;

fs.writeFileSync('flows/assessmentFlow.js', flowFileContent);
console.log('Wrote flows/assessmentFlow.js (' + flowFileContent.length + ' chars)');

// ── Step 3: remove the original function from webhook.js ──
content = content.slice(0, startIdx) + content.slice(endIdx);

// ── Step 4: insert require + buildAssessmentDeps() after buildWorksheetDeps() ──
const depsAnchor = 'triggerGeneration: processGeneration, // placeholder until core/generationPipeline.js exists\n  });\n}';
const depsAnchorCRLF = 'triggerGeneration: processGeneration, // placeholder until core/generationPipeline.js exists\r\n  });\r\n}';

let anchorIdx = content.indexOf(depsAnchorCRLF);
let anchorLen = depsAnchorCRLF.length;
if (anchorIdx === -1) {
  anchorIdx = content.indexOf(depsAnchor);
  anchorLen = depsAnchor.length;
}
if (anchorIdx === -1) {
  console.log('WARNING: buildWorksheetDeps() closing anchor not found — aborting.');
  process.exit(1);
}

const insertion = `

// ── Assessment flow module (extracted from this file) ──────────────────────
const { handleAssessmentFlow } = require('../flows/assessmentFlow');

function buildAssessmentDeps() {
  return Object.freeze({
    hashPhone,
    safeSendMessage,
    gradeLabel,
    isProActive,
    getTeacherByPhone,
    dataAssessmentState,
    parseMarks,
    extractMarksFromImage,
    getFormatHelpText,
    processAssessmentData,
  });
}`;

content = content.slice(0, anchorIdx + anchorLen) + insertion + content.slice(anchorIdx + anchorLen);

// ── Step 5: update the 3 call sites ──
let callSiteCount = 0;

content = content.replace(
  /if \(await handleDataAssessmentFlow\(from, '', message\)\)/g,
  () => { callSiteCount++; return "if (await handleAssessmentFlow(from, '', message, null, buildAssessmentDeps()))"; }
);
content = content.replace(
  /if \(await handleDataAssessmentFlow\(from, text, message\)\)/g,
  () => { callSiteCount++; return "if (await handleAssessmentFlow(from, text, message, null, buildAssessmentDeps()))"; }
);
content = content.replace(
  /const dataAssessmentHandled = await handleDataAssessmentFlow\(from, text, message, intent\);/g,
  () => { callSiteCount++; return "const dataAssessmentHandled = await handleAssessmentFlow(from, text, message, intent, buildAssessmentDeps());"; }
);

console.log(`Updated ${callSiteCount} call site(s) (expected 3).`);

fs.writeFileSync(path, content);
console.log('Applied assessment flow extraction to webhook.js.');
console.log('Length before:', originalLength, 'after:', content.length);
