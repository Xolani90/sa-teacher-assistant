'use strict';

const INTENT_TYPES = {
  LESSON_PLAN: 'lessonPlan',
  WORKSHEET: 'worksheet',
  TEST: 'test',
  EXAM_PAPER: 'examPaper',
  RUBRIC: 'rubric',
  SBA_TASK: 'sbaTask',
  EXPLANATION: 'explanation',
  REPORT_COMMENT: 'reportComment',
  PARENT_MESSAGE: 'parentMessage',
  QUICK_QUIZ: 'quickQuiz',
  ATP: 'atp',
  MENTAL_MATHS: 'mentalMaths',
  ASSESSMENT_ANALYSIS: 'assessmentAnalysis',
  DATA_ASSESSMENT: 'dataAssessment',
  INTERVENTION_PLAN: 'interventionPlan',
  MODERATION_PACK: 'moderationPack',
  OBSERVATION: 'observation',
  OBSERVATION_HISTORY: 'observationHistory',
  REFLECTION: 'reflection',
  GROWTH_PLAN: 'growth_plan',
  INCIDENT: 'incident',
  CURRICULUM_QUERY: 'curriculumQuery',
  GREETING: 'greeting',
  SMALL_TALK: 'smallTalk',
  EMOTIONAL_SUPPORT: 'emotionalSupport',
  THANKS: 'thanks',
  UNKNOWN: 'unknown',
};

// Language detection patterns for South African official languages
const LANGUAGE_PATTERNS = [
  { language: 'afrikaans', patterns: [/\b(die|van|vir|is|nie|het|kan|sal|moet|wil|ek|jy|hy|sy|ons|hulle|dit|wat|hoe|waar|wanneer)\b/i] },
  { language: 'isizulu', patterns: [/\b(ngiyakwazi|ngicela|ngiyabonga|kuhle|kakhulu|uma|ukuba|ngithanda|ngifuna|akusiko|isikhathi|ngempilo|ngesizulu)\b/i] },
  { language: 'isixhosa', patterns: [/\b(ndiyakwazi|ndicela|ndiyabulela|kulungile|kakhulu|uba|ukuba|ndithanda|ndifuna|ayikho|ixesha|ngempilo|ngesixhosa)\b/i] },
  { language: 'sesotho', patterns: [/\b(ka keate|ka kopo|ke a leboga|e tota|haholo|haeba|ho ba|rata|batla|ha ho|nako|ka bophelo|ka sesotho)\b/i] },
  { language: 'setswana', patterns: [/\b(ka tshwarelo|ka kopo|ke a leboga|e golo|gantsi|faeba|go ba|rata|batla|ga go|nako|ka botshelo|ka setswana)\b/i] },
  { language: 'sepedi', patterns: [/\b(ka kopo|ke a leboga|kgolo|gantsi|geeba|go ba|rata|batla|ga go|nako|ka bophelo|ka sepedi)\b/i] },
  { language: 'xitsonga', patterns: [/\b(ndzi khomela|ndzi kombela|ndzi ro tini|ku khulaku|kanene|laha|ku va|ndzi rhandza|ndzi lava|a ku|nkarhi|ka vuxaka)\b/i] },
  { language: 'siswati', patterns: [/\b(ngikucela|ngiyabonga|kuhle|kakhulu|uma|kuba|ngitfandza|ngifuna|akukho|sikhathi|ngempilo|ngesitswatsi)\b/i] },
  { language: 'tshivenda', patterns: [/\b(ndi khou humbela|ndi a livhuwa|ni li vhudi|hu na tshi|arali|i ri|ndi li rata|ndi lavhele|a i|tshifhinga|sha vhuwilani)\b/i] },
  { language: 'isindebele', patterns: [/\b(ngicela|ngiyabonga|kuhle|kakhulu|uma|ukuba|ngithanda|ngifuna|akukho|isikhathi|ngempilo|ngesindebele)\b/i] },
];

function detectLanguage(text) {
  const lower = text.toLowerCase();
  for (const { language, patterns } of LANGUAGE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) {
        return language;
      }
    }
  }
  return 'english'; // Default to English if no language detected
}

const SUBJECT_PATTERNS = [
  { subject: 'mathematics', pattern: /\b(maths?|math(?:ematics)?|algebra|geometry|calculus|trigonometry|fractions?|decimals?|percentage|equations?|arithmetic|statistics|probability|integers?|ratio|proportion|quadratic|linear|wiskunde|meetkunde|breuke|fraksies)\b/i },
  { subject: 'physical sciences', pattern: /\b(physical\s+sciences?|physics|chemistry|chemical|atom|molecule|force|energy|reaction|periodic table|waves?|electricity|circuit|thermodynamics|fisiese wetenskappe|fisika|chemie|skeikunde)\b/i },
  { subject: 'natural sciences', pattern: /\b(natural\s+sciences?|natuur(?:like)?\s*wetenskappe?)\b/i },
  { subject: 'life sciences', pattern: /\b(biology|life\s+sciences?|photosynthesis|cell|organ|dna|evolution|ecosystem|genetics|respiration|digestion|biosphere|organism|lewenswetenskappe|biologie)\b/i },
  { subject: 'english', pattern: /\b(english|grammar|poem|poetry|essay|novel|prose|simile|metaphor|narrative|language|comprehension|literature|writing|speech|figurative)\b/i },
  { subject: 'history', pattern: /\b(history|apartheid|war|revolution|colonial|democracy|timeline|civil rights|geskiedenis)\b/i },
  { subject: 'geography', pattern: /\b(geography|climate|river|biome|population|map|vegetation|soil|weather|ocean|continent|aardrykskunde)\b/i },
  { subject: 'accounting', pattern: /\b(accounting|ledger|balance sheet|income statement|bookkeeping|debit|credit|asset|liability|journal|rekeningkunde)\b/i },
  { subject: 'business studies', pattern: /\b(business|entrepreneur|marketing|management|enterprise|profit|supply|demand|budget)\b/i },
  { subject: 'economics', pattern: /\b(economics|inflation|gdp|unemployment|fiscal|monetary|trade|market)\b/i },
  { subject: 'isizulu', pattern: /\b(isizulu|zulu)\b/i },
  { subject: 'isixhosa', pattern: /\b(isixhosa|xhosa)\b/i },
  { subject: 'afrikaans', pattern: /\b(afrikaans)\b/i },
  { subject: 'sepedi', pattern: /\b(sepedi|northern sotho|sesotho sa leboa)\b/i },
  { subject: 'setswana', pattern: /\b(setswana|tswana)\b/i },
  { subject: 'tourism', pattern: /\b(tourism)\b/i },
  { subject: 'cat', pattern: /\b(cat|computer applications technology|spreadsheet|word processing)\b/i },
  { subject: 'dramatic arts', pattern: /\b(dramatic arts|drama|theatre)\b/i },
  { subject: 'visual arts', pattern: /\b(visual arts|art)\b/i },
  { subject: 'music', pattern: /\b(music)\b/i },
  { subject: 'agricultural sciences', pattern: /\b(agricultural sciences?|agri|farming|crops|livestock)\b/i },
  { subject: 'consumer studies', pattern: /\b(consumer studies|home economics)\b/i },
  { subject: 'hospitality studies', pattern: /\b(hospitality|catering|hotel)\b/i },
  { subject: 'civil technology', pattern: /\b(civil technology|civil tech|construction)\b/i },
  { subject: 'electrical technology', pattern: /\b(electrical technology|electrical tech)\b/i },
  { subject: 'life orientation', pattern: /\b(life orientation|lo)\b/i },
  { subject: 'religion', pattern: /\b(religion|religious studies)\b/i },
  { subject: 'physical education', pattern: /\b(physical education|pe|sport)\b/i },
];

// Words to strip when cleaning up a topic string
const NOISE_WORDS = [
  'create', 'make', 'generate', 'write', 'build', 'give me', 'produce', 'prepare',
  'please', 'can you', 'i need', 'i want',
  'a', 'an', 'the', 'me', 'us', 'some',
  'lesson plan', 'worksheet', 'work sheet', 'test', 'quiz', 'exam', 'assessment',
  'explanation', 'activity', 'exercise',
  'quick', 'starter', 'warm up', 'warm-up', 'entry', 'bell work',
  'for', 'on', 'about', 'regarding', 'covering', 'to',
  'of', 'my', 'class', 'for my', 'in', 'at', 'with', 'our',
  // Subject names only — do NOT add sub-keywords (algebra, biology etc) as they are valid topics
  'mathematics', 'maths', 'math',
  'physical sciences', 'life sciences',
  'english', 'history', 'geography', 'accounting', 'business studies', 'economics',
  'isizulu', 'isixhosa', 'afrikaans', 'sepedi', 'setswana',
  'tourism', 'computer applications technology', 'dramatic arts',
  'visual arts', 'music', 'agricultural sciences',
  'consumer studies', 'hospitality studies', 'civil technology', 'electrical technology',
  'life orientation', 'religion', 'physical education',
  // Content type words
  'lesson', 'plan',
  'annual teaching plan', 'atp', 'annual plan', 'year plan', 'yearly plan', 'term plan',
  'rubric', 'marking rubric', 'assessment rubric', 'analytical rubric',
  'sba task', 'sba', 'school-based assessment', 'formal task',
  'exam paper', 'examination paper', 'exam', 'examination', 'formal exam',
  'moderation pack', 'moderation package', 'moderation checklist', 'moderation document',
  'moderation documents', 'moderation paperwork', 'moderation cover sheet', 'moderation',
  // Subject names (added)
  'natural sciences',
  // Afrikaans filler/noise words
  'oor', 'vir', 'van', 'die', 'oor die', 'verduidelik', 'verduideliking',
  'werkblad', 'werksblad', 'oefening', 'toets', 'eksamen', 'vraestel',
  'lesplan', 'onderrigplan', 'graad', 'vinnige', 'begintoets',
];

function cleanTopic(raw) {
  let topic = raw;
  // Remove grade references
  topic = topic.replace(/\b(?:grade|gr|g|graad)[\s.]?(?:\d{1,2}|r)\b/gi, '');
  // Remove mark references
  topic = topic.replace(/\b\d{1,3}\s*(?:-|–)?\s*marks?\b/gi, '');
  // Remove term references (e.g. "term 3") — these describe WHEN, not the
  // topic itself. Leaving these in place used to let a message like
  // "lesson plan grade 7 maths term 3" fall through cleanTopic() with
  // topic="term 3", a meaningless "topic" that would silently skip ATP
  // auto-resolution downstream (since intent.topic was truthy).
  topic = topic.replace(/\b(?:term|kwartaal)[\s.]?[1-4]\b/gi, '');
  // Remove noise words (whole word, case insensitive)
  for (const word of NOISE_WORDS) {
    const escaped = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    topic = topic.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '');
  }
  // Strip explanation trigger words (whole word, case insensitive)
  const explanationTriggers = [
    'explain', 'verduidelik', 'verduideliking', 'describe', 'wat is',
    'tell me about', 'tell me', 'what is', 'what are', 'how does', 'how do',
    'simply', 'simple', 'easy', 'basics', 'basic',
    'introduction to', 'intro to', 'overview of', 'overview',
  ];
  for (const trigger of explanationTriggers) {
    const escaped = trigger.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    topic = topic.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '');
  }
  // Collapse whitespace
  topic = topic.replace(/\s+/g, ' ').trim();
  return topic;
}

const { parseGrade } = require('./capsPhase');

function parseIntent(text) {
  const lower = text.toLowerCase().trim();

  // --- Detect language ---
  const language = detectLanguage(text);

  // --- Detect content type ---
  let type = INTENT_TYPES.EXPLANATION;

  // Check conversational intents first (these should NOT trigger generation)
  // GREETING patterns
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|howzit|sawubona|dumela|molweni|greetings|hallo|haai)\b/i.test(lower.trim())) {
    type = INTENT_TYPES.GREETING;
  // THANKS patterns
  } else if (/\b(thanks|thank you|thank you very much|appreciate it|awesome thanks|thanks a lot|much appreciated|cheers)\b/i.test(lower)) {
    type = INTENT_TYPES.THANKS;
  // SMALL_TALK patterns
  } else if (/\b(how are you|how's it going|how's your day|are you there|is this working|what's up|what's happening|how do you do)\b/i.test(lower)) {
    type = INTENT_TYPES.SMALL_TALK;
  // CURRICULUM_QUERY — teacher asking about curriculum position, ATP topics, coverage, pacing
  // Must be checked BEFORE the ATP check to prevent keyword overlap
  } else if (/\b(am\s+i\s+behind|on\s+track|behind\s+schedule|catch[\s-]?up|curriculum\s+coverage|how\s+much\s+(curriculum|have\s+i\s+covered)|curriculum\s+progress|what\s+(topics|work)\s+(should\s+i|do\s+i)\s+(be\s+)?(teaching|cover(ing)?)\s+this\s+week|still\s+to\s+cover|outstanding\s+topics|remaining\s+topics|term\s+progress|what.*atp.*week|what.*week.*atp|coverage\s+report|syllabus\s+progress|how\s+far\s+(am\s+i|have\s+i\s+got)|pacing|concept[s]?\s+(still\s+)?need(ing)?\s+(formal\s+)?assess|covered\s+enough|enough\s+work\s+for|what\s+topics.*still|topics.*still.*need|what.*should.*i.*teach|have\s+i\s+covered)/i.test(lower)) {
    type = INTENT_TYPES.CURRICULUM_QUERY;
  // ATP (checked before EMOTIONAL_SUPPORT and lessonPlan — "annual teaching plan" / "year plan" must not fall into either)
  } else if (/\b(annual\s+teaching\s+plan|atp|year\s+plan|yearly\s+plan|annual\s+plan)\b/i.test(lower) ||
      /\bterm\s+plan\b/i.test(lower)) {
    type = INTENT_TYPES.ATP;
  // MENTAL_MATHS detection (checked before WORKSHEET/TEST — "mental maths worksheet"
  // or "mental maths quiz" must resolve here, not fall into the generic
  // worksheet/test branches below, since Mental Maths is strand-based fluency
  // practice with its own deterministic generator, not a CAPS-topic worksheet/test)
  } else if (/\b(mental\s+maths?|mental\s+math|maths?\s+mentals?|mental\s+fluency|number\s+facts?\s+practice)\b/i.test(lower)) {
    type = INTENT_TYPES.MENTAL_MATHS;
  // Assessment analysis / diagnostics (checked before EMOTIONAL_SUPPORT and the generic
  // "test"/"assessment" regex — both would otherwise wrongly intercept phrases like
  // "where are my learners struggling")
  // Data-driven assessment — teacher wants to UPLOAD marks for structured statistical analysis
  // (item analysis, error analysis, learner grouping). Checked BEFORE the conversational
  // assessmentAnalysis branch so "upload marks" doesn't fall into the text-only flow.
  } else if (/\b(upload\s+marks?|submit\s+marks?|enter\s+marks?|capture\s+marks?|data[\s-]driven\s+analysis|full\s+item\s+analysis|error\s+analysis|difficulty\s+index|facility\s+value|discrimination\s+index|learner\s+group(ing)?|group\s+learners?|analyse\s+this\s+test|analyze\s+this\s+test)\b/i.test(lower)) {
    type = INTENT_TYPES.DATA_ASSESSMENT;
  } else if (/\b(assessment\s+analysis|analy[sz]e\s+(my\s+)?(test|results|marks|scores)|item\s+analysis|class\s+results|how\s+did\s+(my\s+)?class\s+do|mark\s+analysis|diagnos(e|tic|tics)|where\s+(are\s+)?(my\s+)?learners?\s+(are\s+)?struggling|class\s+performance|test\s+results\s+breakdown)\b/i.test(lower)) {
    type = INTENT_TYPES.ASSESSMENT_ANALYSIS;
  // MODERATION_PACK detection (before RUBRIC/SBA_TASK/INTERVENTION_PLAN — must win
  // over generic "assessment"/"sba" phrasing since it names a specific document type)
  } else if (/\b(moderation\s+pack|moderation\s+pack(?:age)?|moderation\s+checklist|moderation\s+document|moderation\s+(documents?|paperwork)|pack\s+for\s+moderation|prepare\s+(this\s+|my\s+)?for\s+moderation|moderation\s+cover\s+sheet)\b/i.test(lower)) {
    type = INTENT_TYPES.MODERATION_PACK;
  // RUBRIC detection (before INTERVENTION_PLAN — "rubric" must never fall through to it)
  } else if (/\b(rubric|marking rubric|assessment rubric|analytical rubric|holistic rubric|rubric for|evaluation rubric|beoordeling(?:slys)?|beoordelingsrubriek)\b/i.test(lower)) {
    type = INTENT_TYPES.RUBRIC;
  // SBA task detection (before INTERVENTION_PLAN — "sba task" is a generation intent, not support planning)
  } else if (/\b(sba\s+task|school[- ]based\s+assessment\s+task|sba\s+assignment|sba\s+project|sba\s+investigation|formal\s+task|formal\s+assessment\s+task|program(?:me)?\s+of\s+assessment|poa\s+task|sba\s+test|sba\s+oral|sba\s+practical|taak|formele\s+taak)\b/i.test(lower)) {
    type = INTENT_TYPES.SBA_TASK;
  // EXAM_PAPER detection (before INTERVENTION_PLAN and TEST)
  } else if (/\b(exam\s+paper|examination\s+paper|formal\s+exam|half[- ]year\s+exam|mid[- ]year\s+exam|end[- ]of[- ]year\s+exam|final\s+exam|june\s+exam|november\s+exam)\b/i.test(lower)) {
    type = INTENT_TYPES.EXAM_PAPER;
  // OBSERVATION_HISTORY detection (before OBSERVATION — "my observations" / "show
  // observations" is a request to VIEW past saved assessments, not to record a new
  // one, and must not fall into the record-new-observation branch below)
  } else if (/\b(my\s+observations?|show\s+observations?|view\s+observations?|observation\s+history|list\s+observations?|see\s+(my\s+)?observations?)\b/i.test(lower)) {
    type = INTENT_TYPES.OBSERVATION_HISTORY;
  // OBSERVATION detection (before INTERVENTION_PLAN/EMOTIONAL_SUPPORT — developmental
  // observation notes for Foundation Phase learners are distinct from marks-based
  // assessment or "struggling learner" support-planning language)
  } else if (/\b(record\s+(an\s+)?observation|log\s+(an\s+)?observation|capture\s+(an\s+)?observation|developmental\s+observation|foundation\s+phase\s+observation|observation\s+(notes?|record)|observe\s+(a\s+)?learner)\b/i.test(lower)) {
    type = INTENT_TYPES.OBSERVATION;
  // REFLECT — bare shortcut command, alias for the natural-language reflection phrases
  } else if (/^reflect\.?$/i.test(lower)) {
    type = INTENT_TYPES.REFLECTION;
  // REFLECTION detection (narrow phrasing only — do not expand yet)
  } else if (/log\s+(a\s+)?reflection|record\s+(a\s+)?reflection|reflect\s+on\s+(my|this)\s+lesson/i.test(lower)) {
    type = INTENT_TYPES.REFLECTION;
  // INCIDENT — bare shortcut command, alias for the natural-language incident phrases
  } else if (/^incident\.?$/i.test(lower)) {
    type = INTENT_TYPES.INCIDENT;
  // INCIDENT detection (narrow phrasing only, mirrors REFLECTION/GROWTH_PLAN above)
  } else if (/log\s+(an\s+)?incident|record\s+(an\s+)?incident|report\s+(an\s+)?incident|incident\s+book/i.test(lower)) {
    type = INTENT_TYPES.INCIDENT;
  // NEW GOAL — bare shortcut command, alias for the natural-language growth-plan phrases
  } else if (/^new\s+goal\.?$/i.test(lower)) {
    type = INTENT_TYPES.GROWTH_PLAN;
  // GROWTH_PLAN detection (narrow phrasing only, mirrors REFLECTION above — do not expand yet)
  } else if (/create\s+(a\s+)?growth\s+plan|\bgrowth\s+plan\b|development\s+plan|professional\s+growth/i.test(lower)) {
    type = INTENT_TYPES.GROWTH_PLAN;
  // Intervention planning / SBA support (sba\s+task removed — now handled by SBA_TASK above)
  } else if (/\b(intervention\s+plan|intervention\s+strategy|sba\s+support|sba\s+(schedule|plan)|reteach(ing)?\s+plan|catch[\s-]?up\s+plan|support\s+plan|remedial\s+plan|struggling\s+learners?|learners?\s+(are\s+)?(struggling|falling\s+behind)|school[\s-]based\s+assessment)\b/i.test(lower)) {
    type = INTENT_TYPES.INTERVENTION_PLAN;
  // EMOTIONAL_SUPPORT — matches feelings/venting phrases incl. standalone "rough" and "was rough"
  } else if (/\b(exhausted|tired|stressed|stressful|overwhelmed|struggling|difficult class|rough\s*day|terrible day|bad day|hard day|parent problems|tired of marking|burnout|burning out|frustrated|upset|worried|anxious)\b/i.test(lower) ||
             /\b(was rough|been rough|felt rough|so rough|too rough|really rough|it.?s rough)\b/i.test(lower)) {
    type = INTENT_TYPES.EMOTIONAL_SUPPORT;
  } else if (/\b(lesplan|onderrigplan)\b/i.test(lower)) {
    type = INTENT_TYPES.LESSON_PLAN;
  } else if (/\b(verduidelik|verduideliking|wat is)\b/i.test(lower)) {
    type = INTENT_TYPES.EXPLANATION;
  } else if (/\b(lesson.?plan|lesson\s+for|prepare\s+a\s+lesson|teaching\s+plan|learning\s+plan)\b/i.test(lower)) {
    type = INTENT_TYPES.LESSON_PLAN;
  } else if (/\b(worksheet|work\s+sheet|activity\s+sheet|exercises?\s+for|practice\s+questions|questions\s+for)\b/i.test(lower)) {
    type = INTENT_TYPES.WORKSHEET;
  } else if (/\b(test|quiz|exam|examination|assessment|evaluation|(\d+)[\s-]?mark)\b/i.test(lower)) {
    type = INTENT_TYPES.TEST;
  } else if (/\b(report\s+comment|report\s+comments|comments?\s+for\s+report|learner\s+comment|write\s+comment)\b/i.test(lower)) {
    type = INTENT_TYPES.REPORT_COMMENT;
  } else if (/\b(explain|explanation|what\s+is|what\s+are|describe|definition|how\s+does|how\s+do|tell\s+me\s+about|simple\s+explanation)\b/i.test(lower)) {
    type = INTENT_TYPES.EXPLANATION;
  } else {
    // If no specific intent matched, classify as UNKNOWN
    type = INTENT_TYPES.UNKNOWN;
  }

  // --- Extract grade ---
  const grade = parseGrade(lower);

  // --- Extract marks ---
  const marksMatch = lower.match(/\b(\d{1,3})\s*(?:-|–)?\s*marks?\b/i);
  const marks = marksMatch ? Math.min(100, Math.max(5, parseInt(marksMatch[1], 10))) : 20;
  // --- Extract explicit question count (worksheet-specific; e.g. "15 questions") ---
  const questionCountMatch = lower.match(/\b(\d{1,2})\s*(?:-|\u2013)?\s*questions?\b/i);
  const questionCount = questionCountMatch ? Math.min(30, Math.max(1, parseInt(questionCountMatch[1], 10))) : null;

  // --- Detect subject ---
  let subject = 'general';
  for (const { subject: subjectName, pattern } of SUBJECT_PATTERNS) {
    if (pattern.test(lower)) {
      subject = subjectName;
      break;
    }
  }

  // --- Extract topic ---
  // Strategy: take the full text, strip everything that isn't the core topic
  let topic = cleanTopic(text);

  // Get all subject names for validation
  const allSubjects = SUBJECT_PATTERNS.map(p => p.subject);
  const contentTypeWords = ['worksheet', 'test', 'lessonplan', 'lesson', 'plan', 'explanation', 'lessonplan', 'atp'];

  // If topic is empty or too short after cleaning, or equals a subject/content type, set to null
  if (!topic || topic.length < 3 || allSubjects.includes(topic.toLowerCase()) || contentTypeWords.includes(topic.toLowerCase())) {
    topic = null;
  }

  // If topic is null, use subject or original key nouns (skip for parent message)
  if (!topic && type !== INTENT_TYPES.PARENT_MESSAGE) {
    if (subject !== 'general') {
      topic = subject;
    } else {
      // Last resort: take the longest word from the original text
      const words = text.split(/\s+/).filter(w => w.length > 4);
      topic = words[words.length - 1] || text.trim();
    }
  }

  // For parent message intent, topic is not needed (situation and learnerName are extracted separately)
  if (type === INTENT_TYPES.PARENT_MESSAGE) {
    topic = null;
  }

  // For ATP, topic is not meaningful — scope is the full year curriculum
  if (type === INTENT_TYPES.ATP) {
    topic = null;
  }

  // Mental Maths is strand-based (six fixed strands cycled per session),
  // not topic-based — clear any free-text "topic" cleanTopic() extracted
  // so it never leaks into the ack message or a saved-resource title.
  if (type === INTENT_TYPES.MENTAL_MATHS) {
    topic = null;
  }

  // Assessment analysis and intervention planning collect their data via a
  // guided conversation (grade, subject, performance details) rather than a
  // free-text "topic" — clear it so the flow handler always asks properly.
  if (type === INTENT_TYPES.ASSESSMENT_ANALYSIS || type === INTENT_TYPES.DATA_ASSESSMENT || type === INTENT_TYPES.INTERVENTION_PLAN || type === INTENT_TYPES.OBSERVATION || type === INTENT_TYPES.OBSERVATION_HISTORY || type === INTENT_TYPES.REFLECTION) {
    topic = null;
  }

  return { type, grade, subject, topic, marks, questionCount, language };
}

module.exports = { parseIntent, INTENT_TYPES };
