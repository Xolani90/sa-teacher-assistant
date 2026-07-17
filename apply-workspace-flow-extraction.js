// Run from repo root: node apply-workspace-flow-extraction.js
// Prereq: flows/workspaceFlow.js must already exist (copy it in first).
const fs = require('fs');
const path = 'routes/webhook.js';
let content = fs.readFileSync(path, 'utf-8');
const originalLength = content.length;

// ── Step 1: insert handleWorkspaceFlow call + buildWorkspaceDeps() before isWorkspaceCmd ──
// CRLF-tolerant regex instead of exact string match
const isWorkspaceCmdRe = /const isWorkspaceCmd =\r?\n\s*upper === 'MY CLASSES' \|\| upper\.startsWith\('NEW CLASS'\) \|\|\r?\n\s*upper === 'MY ASSESSMENTS' \|\| upper === 'MY ASSESSMENT HISTORY' \|\|\r?\n\s*upper === 'MY PROGRESS' \|\| upper === 'MY CURRICULUM PROGRESS' \|\|\r?\n\s*upper === 'WORKSPACE' \|\|\r?\n\s*upper === 'MY RESOURCES' \|\|\r?\n\s*upper === 'SAVE';/;

const isWorkspaceCmdNew = `const { handleWorkspaceFlow } = require('../flows/workspaceFlow');

  function buildWorkspaceDeps() {
    const {
      getTeacherClasses,
      createClass,
      getAssessmentHistory,
      validateNewClassInput,
    } = require('../services/teacherWorkspaceService');
    const { getTeacherProgressReport } = require('../services/curriculumCoverageService');
    const { handleCurriculumQuery: calendarQuery } = require('../services/curriculumIntelligenceService');

    return Object.freeze({
      hashPhone,
      getTeacherByPhone,
      safeSendMessage,
      gradeLabel,
      getTeacherClasses,
      createClass,
      getAssessmentHistory,
      validateNewClassInput,
      getTeacherProgressReport,
      calendarQuery,
    });
  }

  if (await handleWorkspaceFlow(from, text, buildWorkspaceDeps())) return true;

  const isWorkspaceCmd =
    upper === 'MY RESOURCES' ||
    upper === 'SAVE';`;

if (!isWorkspaceCmdRe.test(content)) {
  console.log('WARNING: isWorkspaceCmd block not found (regex) — no changes made. Aborting.');
  process.exit(1);
}
content = content.replace(isWorkspaceCmdRe, isWorkspaceCmdNew);

// ── Step 2: replace the inline requires + hash/teacher guard + NEW CLASS..WORKSPACE
//            blocks with just the requires SAVE/MY RESOURCES actually need ──
const startRe = /if \(isWorkspaceCmd\) \{\r?\n\s*const \{\r?\n\s*getTeacherClasses,\r?\n\s*createClass,\r?\n\s*getAssessmentHistory,\r?\n\s*validateNewClassInput,\r?\n\s*saveResource,\r?\n\s*getSavedResources,\r?\n\s*getSavedResourceByGenerationId,\r?\n\s*\} = require\('\.\.\/services\/teacherWorkspaceService'\);\r?\n\s*const \{ getTeacherProgressReport \} = require\('\.\.\/services\/curriculumCoverageService'\);\r?\n\s*const \{ handleCurriculumQuery: calendarQuery \} = require\('\.\.\/services\/curriculumIntelligenceService'\);\r?\n\r?\n\s*const hash = hashPhone\(from\);\r?\n\s*const teacher = getTeacherByPhone\(from\);\r?\n\r?\n\s*if \(!teacher\) \{\r?\n\s*await safeSendMessage\(from, `⚠️ You need to complete setup first\. Reply \*HELLO\* to get started\.`\);\r?\n\s*return true;\r?\n\s*\}\r?\n\r?\n\s*\/\/ ── NEW CLASS ──/;

const endMarker = '// ── SAVE ─';

const startMatch = content.match(startRe);
if (!startMatch) {
  console.log('WARNING: workspace body start marker not found (regex) — aborting.');
  process.exit(1);
}
const startIdx = startMatch.index;
const endIdx = content.indexOf(endMarker, startIdx);

if (endIdx === -1) {
  console.log('WARNING: end marker "' + endMarker + '" not found after start — aborting.');
  process.exit(1);
}

const replacement = `if (isWorkspaceCmd) {
    const {
      saveResource,
      getSavedResources,
      getSavedResourceByGenerationId,
    } = require('../services/teacherWorkspaceService');

    `;

content = content.slice(0, startIdx) + replacement + content.slice(endIdx);

fs.writeFileSync(path, content);
console.log('Applied workspace flow extraction.');
console.log('Length before:', originalLength, 'after:', content.length);
