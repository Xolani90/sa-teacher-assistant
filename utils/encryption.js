'use strict';

/**
 * AES-256-GCM encryption / decryption for phone numbers.
 *
 * Used to store teacher phone numbers so that:
 *  1. Payment confirmation messages can be sent after Yoco webhook fires.
 *  2. Pro renewal reminder messages can be sent 3 days before expiry.
 *
 * Why AES-256-GCM instead of the HMAC hash used elsewhere?
 *  HMAC is one-way — you can verify a phone but cannot recover it.
 *  To SEND a WhatsApp message we need the actual number.
 *  GCM is authenticated (provides tamper detection) and reversible.
 *
 * Key derivation:
 *  We derive a 32-byte key from PII_SECRET via SHA-256 so the same
 *  secret drives both the HMAC hashing and the symmetric encryption —
 *  no extra env var required.
 *
 * POPIA note: encrypted phone numbers are still PII. The DB must be
 * kept on a private persistent disk (never publicly exposed).
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES  = 12;  // 96-bit IV is the GCM standard
const TAG_BYTES = 16;

/**
 * Derives a 32-byte key from PII_SECRET.
 * Calling this on a missing secret fails loudly — better than silent
 * encryption with an empty key.
 *
 * @returns {Buffer}
 */
function deriveKey() {
  const secret = process.env.PII_SECRET;
  if (!secret) throw new Error('PII_SECRET env var is not set');
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a phone number.
 * Returns a base64-encoded string: IV (12 bytes) || auth tag (16 bytes) || ciphertext.
 *
 * @param {string} phone
 * @returns {string}
 */
function encryptPhone(phone) {
  const key    = deriveKey();
  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(phone, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Pack: iv | tag | ciphertext → single base64 string
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypts a phone number encrypted with encryptPhone().
 * Returns null if decryption fails (bad key, tampered data, etc.)
 * rather than throwing — callers must handle null gracefully.
 *
 * @param {string} encoded  - base64 string from encryptPhone()
 * @returns {string|null}
 */
function decryptPhone(encoded) {
  if (!encoded) return null;
  try {
    const key  = deriveKey();
    const buf  = Buffer.from(encoded, 'base64');
    const iv   = buf.slice(0, IV_BYTES);
    const tag  = buf.slice(IV_BYTES, IV_BYTES + TAG_BYTES);
    const data = buf.slice(IV_BYTES + TAG_BYTES);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
  } catch (err) {
    console.error('[ENCRYPT] Decryption failed:', err.message);
    return null;
  }
}

module.exports = { encryptPhone, decryptPhone };
