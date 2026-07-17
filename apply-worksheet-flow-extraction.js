// Run from repo root: node apply-worksheet-flow-extraction.js
// Prereq: flows/worksheetFlow.js must already exist (copy it in first).
const fs = require('fs');
const path = 'routes/webhook.js';
let content = fs.readFileSync(path, 'utf-8');
const originalLength = content.length;

// ── Step 1: insert require + buildWorksheetDeps() right after buildObservationDeps() ──
const depsAnchor = 'getObservationAssessment,\n  });\n}';
const depsAnchorCRLF = 'getObservationAssessment,\r\n  });\r\n}';

let anchorIdx = content.indexOf(depsAnchorCRLF);
let anchorLen = depsAnchorCRLF.length;
if (anchorIdx === -1) {
  anchorIdx = content.indexOf(depsAnchor);
  anchorLen = depsAnchor.length;
}
if (anchorIdx === -1) {
  console.log('WARNING: buildObservationDeps() closing anchor not found — aborting.');
  process.exit(1);
}

const insertion = `

// ── Worksheet flow module (extracted from this file) ───────────────────────
const {
  handleWorksheetFlow,
  recordWorksheetGeneration,
} = require('../flows/worksheetFlow');

function buildWorksheetDeps() {
  return Object.freeze({
    lastWorksheetState,
    safeSendMessage,
    hashPhone,
    triggerGeneration: processGeneration, // placeholder until core/generationPipeline.js exists
  });
}`;

content = content.slice(0, anchorIdx + anchorLen) + insertion + content.slice(anchorIdx + anchorLen);

// ── Step 2: replace the EASIER/HARDER/VISUAL/ORAL blocks with a single dispatch call ──
const startMarker = '// ── EASIER command (differentiation) ─────────────────────────────────';
const endMarker = '// ── FORMAL command (parent message) ────────────────────────────────';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  console.log(`WARNING: EASIER..FORMAL markers not found correctly. start=${startIdx} end=${endIdx} — aborting.`);
  process.exit(1);
}

const dispatchReplacement =
  `// ── Worksheet differentiation commands (EASIER/HARDER/VISUAL/ORAL) — extracted ─
  if (await handleWorksheetFlow(from, text, buildWorksheetDeps())) return true;

  `;

content = content.slice(0, startIdx) + dispatchReplacement + content.slice(endIdx);

// ── Step 3: replace the lastWorksheetState.set(...) + nudge block in processGeneration ──
const genStartMarker = '// ── Worksheet state storage and differentiation follow-up (Feature 2) ───────';
const genEndMarker = '// ── Quick quiz follow-up (Feature 4) ────────────────────────────────────────';

const genStartIdx = content.indexOf(genStartMarker);
const genEndIdx = content.indexOf(genEndMarker);

if (genStartIdx === -1 || genEndIdx === -1 || genEndIdx <= genStartIdx) {
  console.log(`WARNING: worksheet-state-storage markers not found correctly. start=${genStartIdx} end=${genEndIdx} — aborting.`);
  process.exit(1);
}

const genReplacement =
  `// ── Worksheet state storage and differentiation follow-up (Feature 2) — extracted ─
  if (intent.type === 'worksheet' && !intent.differentiation) {
    recordWorksheetGeneration(from, intent, content, buildWorksheetDeps());
  }

  `;

content = content.slice(0, genStartIdx) + genReplacement + content.slice(genEndIdx);

fs.writeFileSync(path, content);
console.log('Applied worksheet flow extraction.');
console.log('Length before:', originalLength, 'after:', content.length);
