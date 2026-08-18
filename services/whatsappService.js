'use strict';

const https = require('https');

const GRAPH_API_VERSION = 'v20.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const GRAPH_TIMEOUT_MS = 15_000; // 15 seconds per send attempt

const MAX_CHARS = 3800; // Stay safely under WhatsApp's 4096 limit

// ── Message chunker ────────────────────────────────────────────────────────
// Fixed version: counts actual chunks AFTER splitting before labelling.
// Original had a bug where estimated part count could be wrong.

/**
 * Splits text into WhatsApp-safe chunks, breaking on paragraph boundaries.
 * Labels multi-part messages with accurate "Part N/Total" headers.
 *
 * @param {string} text
 * @returns {string[]}
 */
function chunkMessage(text) {
  if (!text || text.length === 0) return ['No content generated.'];
  if (text.length <= MAX_CHARS) return [text];

  // ── Pass 1: split into raw chunks ──────────────────────────────
  const rawChunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHARS) {
      rawChunks.push(remaining);
      break;
    }

    let slice = remaining.slice(0, MAX_CHARS);

    // Prefer paragraph break
    const doubleNl = slice.lastIndexOf('\n\n');
    if (doubleNl > MAX_CHARS * 0.6) {
      slice = slice.slice(0, doubleNl);
    } else {
      // Fall back to line break
      const singleNl = slice.lastIndexOf('\n');
      if (singleNl > MAX_CHARS * 0.7) {
        slice = slice.slice(0, singleNl);
      }
      // Otherwise hard cut at limit
    }

    // Guard: if slice is empty, take at least 1 char to guarantee progress
    if (slice.length === 0) {
      slice = remaining.slice(0, MAX_CHARS);
    }

    const trimmed = slice.trim();
    if (trimmed.length > 0) {
      rawChunks.push(trimmed);
    }
    remaining = remaining.slice(Math.max(1, slice.length)).trim();
  }

  // ── Pass 2: label with correct total ──────────────────────────
  const total = rawChunks.length;
  if (total === 0) return ['No content generated.'];
  if (total === 1) return rawChunks; // No label for single-part

  return rawChunks.map((chunk, i) => `📄 Part ${i + 1}/${total}\n\n${chunk}`);
}

// ── Graph API HTTP helper ──────────────────────────────────────────────────

/**
 * POSTs to the Meta Graph API with timeout and proper error messages.
 *
 * @param {string} url
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
function graphPost(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(url);

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(result);
          } else {
            const errDetail = result?.error?.message || JSON.stringify(result).slice(0, 200);
            const graphErr = new Error(`Graph API ${res.statusCode}: ${errDetail}`);
            // RC1-H-015: preserve Meta's structured error code (e.g. 131056,
            // "Re-engagement message" / messaging-pair throttle) so callers
            // upstream can classify specific Graph error conditions instead
            // of string-matching the message text. Only attached when Meta
            // actually returns one — no invented default.
            if (result?.error?.code !== undefined) {
              graphErr.graphErrorCode = result.error.code;
            }
            reject(graphErr);
          }
        } catch {
          reject(new Error(`Failed to parse Graph API response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.setTimeout(GRAPH_TIMEOUT_MS, () => {
      req.destroy(new Error(`WhatsApp API request timed out after ${GRAPH_TIMEOUT_MS / 1000}s`));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Sends a single text message with retry logic.
 *
 * @param {string} to - Recipient phone number (digits only, with country code)
 * @param {string} text - Message body (max 4096 chars)
 * @returns {Promise<void>}
 */
async function sendSingleMessage(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) throw new Error('WHATSAPP_PHONE_NUMBER_ID not set');
  if (!process.env.WHATSAPP_TOKEN) throw new Error('WHATSAPP_TOKEN not set');

  const maxAttempts = 3;
  const delays = [500, 1000, 2000]; // Exponential backoff
  const last4 = to.slice(-4);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await graphPost(`${BASE_URL}/${phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      });
      // Return the Graph API result (contains messages[0].id, the provider
      // message ID) rather than discarding it — callers that need delivery
      // observability (ADR-XXX §5, e.g. routes/auth.js's OTP send) use this
      // to correlate future delivery-status webhooks. Callers that don't
      // care (the vast majority of sendMessage() call sites) can continue
      // to ignore the return value exactly as before — this is a
      // backward-compatible, additive change.
      return result;
    } catch (err) {
      const isLastAttempt = attempt === maxAttempts;

      // Check if error is retryable (5xx or network errors)
      const isRetryable = isRetryableError(err);

      if (!isRetryable || isLastAttempt) {
        // Don't retry on 4xx or after max attempts
        throw err;
      }

      const delay = delays[attempt - 1];
      console.log(`[WHATSAPP] Attempt ${attempt}/${maxAttempts} failed for message to ...${last4} — retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Determines if an error is retryable (5xx or network errors).
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryableError(err) {
  // Network errors
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
    return true;
  }

  // HTTP 5xx errors
  if (err.message && err.message.includes('Graph API 5')) {
    return true;
  }

  return false;
}

/**
 * Sends a document (PDF) via WhatsApp.
 * Requires a publicly accessible URL — we upload to a temp hosting service.
 *
 * @param {string} to
 * @param {string} documentUrl - Public URL to the PDF
 * @param {string} filename - Display filename (e.g. "Grade_7_Maths_Worksheet.pdf")
 * @param {string} [caption]
 * @returns {Promise<void>}
 */
async function sendDocument(to, documentUrl, filename, caption = '') {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) throw new Error('WHATSAPP_PHONE_NUMBER_ID not set');

  await graphPost(`${BASE_URL}/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'document',
    document: {
      link: documentUrl,
      filename,
      caption,
    },
  });
}

/**
 * Sends a message, automatically splitting into chunks if too long.
 * Adds a 500ms delay between chunks to respect Meta rate limits.
 *
 * @param {string} to
 * @param {string} text
 * @returns {Promise<void>}
 */
async function sendMessage(to, text) {
  const chunks = chunkMessage(text);
  let lastResult;

  for (let i = 0; i < chunks.length; i++) {
    lastResult = await sendSingleMessage(to, chunks[i]);
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Returns the LAST chunk's Graph API result. For the single-chunk case
  // (the OTP send path, and the overwhelming majority of messages sent by
  // this app) this is simply "the" result. Existing call sites that
  // ignore the return value are unaffected.
  return lastResult;
}

/**
 * No-op — WhatsApp Cloud API does not support typing indicators on the free tier.
 * Kept for interface compatibility.
 */
async function sendTypingIndicator(_to) {
  // Not supported on Cloud API free tier
}

/**
 * Downloads a WhatsApp media object (document, image, etc.) as a Buffer.
 *
 * Meta's two-step flow:
 *   1. GET /{media-id}  → { url, mime_type, file_size, ... }
 *   2. GET {url}        → binary content (bearer auth required on both steps)
 *
 * @param {string} mediaId  - The media ID from the incoming webhook message
 * @returns {Promise<{ buffer: Buffer, mimeType: string, fileSize: number }>}
 */
async function downloadMedia(mediaId) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error('WHATSAPP_TOKEN not set');

  // Step 1: resolve media ID → temporary download URL
  const metaInfo = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'graph.facebook.com',
      path: `/${GRAPH_API_VERSION}/${mediaId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      timeout: GRAPH_TIMEOUT_MS,
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString());
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse media metadata: ' + e.message));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Media metadata request timed out')); });
    req.on('error', reject);
    req.end();
  });

  const { url, mime_type: mimeType, file_size: fileSize } = metaInfo;
  if (!url) throw new Error('No download URL returned for media ' + mediaId);

  // Step 2: download the actual binary content
  const buffer = await new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      timeout: GRAPH_TIMEOUT_MS,
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Media download timed out')); });
    req.on('error', reject);
    req.end();
  });

  return { buffer, mimeType, fileSize };
}

module.exports = { sendMessage, sendDocument, sendTypingIndicator, chunkMessage, downloadMedia };