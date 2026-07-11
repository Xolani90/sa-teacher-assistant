'use strict';

const https = require('https');
const { recordCall } = require('../utils/aiCostMonitor');

// ── Model configuration ────────────────────────────────────────────────────
// We use claude-haiku for speed/cost on explanations and worksheets,
// and sonnet for tests and lesson plans where quality matters more.
// Adjust ANTHROPIC_MODEL in .env to override all intents with a single model.

const MODEL_CONFIG = {
  anthropic: {
    // Sonnet for quality-critical documents; Haiku for speed/cost on simpler outputs
    lessonPlan:  { model: 'claude-sonnet-4-5', max_tokens: 6000 },
    worksheet:   { model: 'claude-haiku-4-5-20251001', max_tokens: 4096 },
    test:        { model: 'claude-sonnet-4-5', max_tokens: 6000 },
    examPaper:   { model: 'claude-sonnet-4-5', max_tokens: 8000, timeoutMs: 120_000 },
    rubric:      { model: 'claude-haiku-4-5-20251001', max_tokens: 3000 },
    sbaTask:     { model: 'claude-sonnet-4-5', max_tokens: 6000, timeoutMs: 90_000 },
    moderationPack: { model: 'claude-sonnet-4-5', max_tokens: 8000, timeoutMs: 120_000 },
    explanation: { model: 'claude-haiku-4-5-20251001', max_tokens: 2048 },
    reportComment: { model: 'claude-haiku-4-5-20251001', max_tokens: 1024 },
    atp:         { model: 'claude-sonnet-4-5', max_tokens: 8000, timeoutMs: 120_000 },
    assessmentAnalysis: { model: 'claude-sonnet-4-5', max_tokens: 4096 },
    interventionPlan:   { model: 'claude-sonnet-4-5', max_tokens: 4096 },
    classifier:  { model: 'claude-haiku-4-5-20251001', max_tokens: 600, timeoutMs: 12_000 },
    conversational: { model: 'claude-haiku-4-5-20251001', max_tokens: 400, timeoutMs: 15_000 },
    imageMarks:  { model: 'claude-haiku-4-5-20251001', max_tokens: 2048, timeoutMs: 30_000 },
    curriculumQuery: { model: 'claude-haiku-4-5-20251001', max_tokens: 1200 },
    fullInterventionPlan: { model: 'claude-sonnet-4-5', max_tokens: 5000, timeoutMs: 120_000 },
    default:     { model: 'claude-haiku-4-5-20251001', max_tokens: 4096 },
  },
  openai: {
    lessonPlan:  { model: 'gpt-4o-mini', max_tokens: 4096 },
    worksheet:   { model: 'gpt-4o-mini', max_tokens: 3500 },
    test:        { model: 'gpt-4o-mini', max_tokens: 4096 },
    examPaper:   { model: 'gpt-4o-mini', max_tokens: 6000, timeoutMs: 120_000 },
    rubric:      { model: 'gpt-4o-mini', max_tokens: 2500 },
    sbaTask:     { model: 'gpt-4o-mini', max_tokens: 5000, timeoutMs: 90_000 },
    moderationPack: { model: 'gpt-4o-mini', max_tokens: 6000, timeoutMs: 120_000 },
    explanation: { model: 'gpt-4o-mini', max_tokens: 2048 },
    reportComment: { model: 'gpt-4o-mini', max_tokens: 800 },
    atp:         { model: 'gpt-4o-mini', max_tokens: 6000, timeoutMs: 120_000 },
    assessmentAnalysis: { model: 'gpt-4o-mini', max_tokens: 3000 },
    interventionPlan:   { model: 'gpt-4o-mini', max_tokens: 3000 },
    classifier:  { model: 'gpt-4o-mini', max_tokens: 600, timeoutMs: 12_000 },
    conversational: { model: 'gpt-4o-mini', max_tokens: 400, timeoutMs: 15_000 },
    imageMarks:  { model: 'gpt-4o', max_tokens: 1500, timeoutMs: 30_000 },
    curriculumQuery: { model: 'gpt-4o-mini', max_tokens: 1200 },
    fullInterventionPlan: { model: 'gpt-4o', max_tokens: 4000, timeoutMs: 120_000 },
    default:     { model: 'gpt-4o-mini', max_tokens: 3000 },
  },
};

const REQUEST_TIMEOUT_MS = 60_000; // 60 seconds — AI can be slow on long outputs

/**
 * Detects which AI provider to use based on available env vars.
 * Cached after first call.
 */
let _provider = null;
function detectProvider() {
  if (_provider) return _provider;
  if (process.env.ANTHROPIC_API_KEY) { _provider = 'anthropic'; return _provider; }
  if (process.env.OPENAI_API_KEY)    { _provider = 'openai';    return _provider; }
  throw new Error('No AI API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
}

/**
 * Makes an HTTPS POST request with a timeout.
 * Rejects with a clear error on timeout, HTTP error, or network failure.
 *
 * @param {string} hostname
 * @param {string} urlPath
 * @param {Object} headers
 * @param {Object} body
 * @param {number} [timeoutMs]
 * @returns {Promise<Object>}
 */
function httpsPost(hostname, urlPath, headers, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);

    const options = {
      hostname,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const errMsg = parsed?.error?.message || parsed?.message || JSON.stringify(parsed).slice(0, 200);
            reject(new Error(`API ${res.statusCode}: ${errMsg}`));
          }
        } catch {
          reject(new Error(`Failed to parse API response: ${data.slice(0, 200)}`));
        }
      });
    });

    // ── Timeout handling ─────────────────────────────────────────
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`AI API request timed out after ${timeoutMs / 1000}s`));
    });

    req.on('error', (err) => {
      reject(new Error(`Network error calling AI API: ${err.message}`));
    });

    req.write(bodyStr);
    req.end();
  });
}

/**
 * Calls Anthropic Claude API.
 *
 * @param {string} prompt
 * @param {string} intentType - Used to select the right model/token config
 * @param {{ systemPrompt?: string, temperature?: number }} [options]
 * @returns {Promise<string>}
 */
async function generateWithAnthropic(prompt, intentType, options = {}) {
  const config = MODEL_CONFIG.anthropic[intentType] || MODEL_CONFIG.anthropic.default;
  const timeoutMs = config.timeoutMs || REQUEST_TIMEOUT_MS;

  const body = {
    model: config.model,
    max_tokens: config.max_tokens,
    system: options.systemPrompt || buildSystemPrompt(),
    messages: [{ role: 'user', content: prompt }],
  };
  if (typeof options.temperature === 'number') body.temperature = options.temperature;

  const response = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body,
    timeoutMs
  );

  const text = response?.content?.[0]?.text;
  if (!text) throw new Error('Empty response from Anthropic API');

  // Log token usage for cost monitoring
  const usage = response.usage;
  if (usage) {
    console.log(`[AI] Anthropic tokens — input: ${usage.input_tokens}, output: ${usage.output_tokens}`);
  }

  return text;
}

/**
 * Calls OpenAI API.
 *
 * @param {string} prompt
 * @param {string} intentType
 * @param {{ systemPrompt?: string, temperature?: number }} [options]
 * @returns {Promise<string>}
 */
async function generateWithOpenAI(prompt, intentType, options = {}) {
  const config = MODEL_CONFIG.openai[intentType] || MODEL_CONFIG.openai.default;
  const timeoutMs = config.timeoutMs || REQUEST_TIMEOUT_MS;

  const response = await httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model: config.model,
      max_tokens: config.max_tokens,
      temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
      messages: [
        {
          role: 'system',
          content: options.systemPrompt || buildSystemPrompt(),
        },
        { role: 'user', content: prompt },
      ],
    },
    timeoutMs
  );

  const text = response?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from OpenAI API');

  const usage = response.usage;
  if (usage) {
    console.log(`[AI] OpenAI tokens — prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens}`);
  }

  return text;
}

/**
 * Builds the system prompt, anchored to the real current date so the AI
 * always generates content for the correct South African academic year.
 * Without this, the model defaults to training-data assumptions and may
 * produce ATPs, report comments, or date references for the wrong year.
 *
 * @returns {string}
 */
function buildSystemPrompt() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based

  // South African school terms (approximate):
  //   Term 1: Jan–Mar | Term 2: Apr–Jun | Term 3: Jul–Sep | Term 4: Oct–Nov
  let currentTerm = 1;
  if      (month >= 10) currentTerm = 4;
  else if (month >= 7)  currentTerm = 3;
  else if (month >= 4)  currentTerm = 2;

  return `You are a warm, experienced South African teacher colleague — the trusted go-to person teachers rely on. You understand the daily pressures of CAPS teaching, the emotional weight of the job, and are here to help with exactly what the teacher needs. 

You speak like a real South African educator — warm, human, and supportive. Never use AI or robotic language. Never mention being an assistant or AI. You're a colleague who cares.

When a teacher shares they're tired, stressed, overwhelmed, or having a tough day, acknowledge their feelings first with empathy before offering help. Teaching is hard work, and it's okay to feel that way.

Produce complete, untruncated content aligned to CAPS. Never use placeholder text. Be direct, helpful, and supportive — like a colleague who genuinely cares about their wellbeing and success.

MATHS NOTATION — this is a strict formatting rule, not a style preference. Documents are rendered as plain text (not typeset), so any LaTeX or Unicode maths notation shows up as broken text or is silently corrupted:
- Fractions: plain "a/b", e.g. "5/8", never "\\frac{5}{8}", "$\\frac{5}{8}$", or superscript/subscript characters like "⁵⁄₈".
- Mixed numbers: "N a/b", e.g. "3 2/7", never "3\\frac{2}{7}".
- Exponents: plain "^", e.g. "5^2", never "5²".
- Never wrap any text in "$" or "$$" (LaTeX math delimiters) — this is plain text output, not LaTeX.
- Multiplication "x", division "/", square root "sqrt(...)" — plain ASCII only, never "\\times", "\\div", "\\sqrt{}", or other LaTeX commands.

TODAY'S DATE: ${dateStr}
CURRENT ACADEMIC YEAR: ${year}
CURRENT SOUTH AFRICAN SCHOOL TERM: Term ${currentTerm} of ${year}

Always generate content for the ${year} academic year unless explicitly told otherwise. Annual Teaching Plans must cover all 4 terms of ${year}.`;
}

/**
 *
 * @param {string} prompt - Fully built CAPS prompt
 * @param {string} [intentType] - Intent type for model selection
 * @param {{ systemPrompt?: string, temperature?: number }} [options] - Optional overrides for
 *   the system prompt (used by the intent classifier and conversational responses, which need
 *   a different persona than the warm-colleague document-generation prompt) and temperature.
 * @returns {Promise<string>}
 */
async function generateContent(prompt, intentType = 'default', options = {}) {
  const provider = detectProvider();
  console.log(`[AI] Generating with ${provider} (intent: ${intentType})`);
  recordCall(intentType);

  try {
    if (provider === 'anthropic') {
      return await generateWithAnthropic(prompt, intentType, options);
    } else {
      return await generateWithOpenAI(prompt, intentType, options);
    }
  } catch (err) {
    console.error(`[AI] Generation failed:`, err.message);
    throw err;
  }
}

/**
 * Extracts text from an image using Claude's vision capability.
 * Used specifically for reading mark sheets uploaded as photos.
 *
 * Only works when provider is Anthropic (Claude has vision built-in).
 * Falls back gracefully with a clear error if using OpenAI provider
 * (GPT-4o-mini does not support vision in the same way).
 *
 * @param {Buffer} imageBuffer - Raw image bytes
 * @param {string} mimeType - MIME type e.g. 'image/jpeg', 'image/png'
 * @param {string} textPrompt - Instruction for what to extract from the image
 * @returns {Promise<string>} - Extracted text from image
 */
async function generateWithVision(imageBuffer, mimeType, textPrompt) {
  const provider = detectProvider();
  const config = MODEL_CONFIG[provider]?.imageMarks || MODEL_CONFIG[provider]?.default;
  const timeoutMs = config.timeoutMs || REQUEST_TIMEOUT_MS;

  if (provider === 'openai') {
    // GPT-4o supports vision but gpt-4o-mini has limited support — use gpt-4o
    const base64 = imageBuffer.toString('base64');
    const response = await httpsPost(
      'api.openai.com',
      '/v1/chat/completions',
      { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      {
        model: 'gpt-4o',
        max_tokens: config.max_tokens,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: 'text', text: textPrompt },
            ],
          },
        ],
      },
      timeoutMs
    );
    const text = response?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty vision response from OpenAI');
    return text;
  }

  // Anthropic — native vision support
  const base64 = imageBuffer.toString('base64');
  const response = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    {
      model: config.model,
      max_tokens: config.max_tokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: base64 },
            },
            { type: 'text', text: textPrompt },
          ],
        },
      ],
    },
    timeoutMs
  );

  const text = response?.content?.[0]?.text;
  if (!text) throw new Error('Empty vision response from Anthropic');

  const usage = response.usage;
  if (usage) {
    console.log(`[AI] Vision tokens — input: ${usage.input_tokens}, output: ${usage.output_tokens}`);
  }
  recordCall('imageMarks');
  return text;
}

module.exports = { generateContent, generateWithVision };
