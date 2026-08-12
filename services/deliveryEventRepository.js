'use strict';

/**
 * WhatsApp delivery-events repository (ADR-XXX §5).
 *
 * Persistence layer over whatsapp_delivery_events (Migration 041). Mirrors
 * authCodeRepository.js's shape: plain prepared statements, no
 * db.transaction() (compatibility with both better-sqlite3 in production
 * and the node:sqlite test shim used elsewhere in this suite).
 *
 * This is purely observational (§5.1) — nothing here reads or writes
 * auth_codes.consumed_at/superseded_at, and nothing in the OTP
 * generation/verification path may call into here synchronously in a way
 * that could roll back OTP generation. A failed send or a `failed`
 * delivery webhook must never invalidate, expire, or otherwise affect an
 * OTP's validity — that is enforced by never wiring this module's writes
 * to any auth_codes mutation.
 *
 * Two write paths, both landing in the same table:
 *
 *   recordSendResult(...)   — called once, immediately after a delivery
 *                              attempt, by routes/auth.js. auth_code_id is
 *                              always known here (it's the row that was
 *                              just committed). Covers both the success
 *                              case (provider_message_id set,
 *                              event_status='send_accepted') and the
 *                              explicit send-failure diagnostic event
 *                              required by §5 (provider_message_id NULL,
 *                              event_status='send_failed',
 *                              provider_error set). Also opportunistically
 *                              reconciles any earlier-arrived,
 *                              not-yet-correlated webhook rows for the
 *                              same provider_message_id (the early-arrival
 *                              race, §5's implementation acceptance
 *                              criterion).
 *
 *   recordStatusWebhook(...) — called by routes/webhook.js for each
 *                              sent/delivered/read/failed status entry.
 *                              auth_code_id may not yet be known (the
 *                              webhook can race ahead of
 *                              recordSendResult's write) — inserted as
 *                              NULL in that case and backfilled later by a
 *                              subsequent recordSendResult() or
 *                              recordStatusWebhook() call for the same
 *                              provider_message_id.
 *
 * Idempotency: the partial UNIQUE index on
 * (provider_message_id, event_status) WHERE provider_message_id IS NOT NULL
 * (Migration 041) makes re-delivery of the identical logical event
 * (same message ID + same status, e.g. Meta retrying a webhook) a no-op —
 * both write paths use INSERT ... ON CONFLICT DO NOTHING / DO UPDATE
 * against that index rather than a plain INSERT.
 */

const { getDb } = require('../utils/database');

/**
 * Records the outcome of a delivery attempt immediately after it happens,
 * outside the OTP-generation transaction. Always has a known auth_code_id.
 *
 * @param {Object} params
 * @param {number} params.authCodeId
 * @param {string} params.phoneHash
 * @param {string|null} params.providerMessageId - null on send failure
 * @param {string} params.eventStatus - 'send_accepted' | 'send_failed'
 * @param {string|null} [params.providerError]
 * @returns {{id: number}}
 */
function recordSendResult({ authCodeId, phoneHash, providerMessageId, eventStatus, providerError = null }) {
  if (!authCodeId) throw new Error('recordSendResult: authCodeId is required');
  if (!phoneHash) throw new Error('recordSendResult: phoneHash is required');
  if (!eventStatus) throw new Error('recordSendResult: eventStatus is required');

  const db = getDb();

  if (providerMessageId) {
    // Explicit check-then-write (not a SQL-level ON CONFLICT upsert) to
    // stay within the plain-prepared-statement style used elsewhere in
    // this codebase (authCodeRepository.js, observationRepository.js) and
    // to avoid depending on partial-index-targeted upsert syntax across
    // both the better-sqlite3 production driver and the node:sqlite test
    // shim. better-sqlite3 is synchronous and single-connection per
    // process, so this check-then-write is race-free within one process;
    // cross-process concurrency is bounded by SQLite's own file-level
    // write serialization.
    const existing = db
      .prepare(`
        SELECT id, auth_code_id AS authCodeId
        FROM whatsapp_delivery_events
        WHERE provider_message_id = ? AND event_status = ?
      `)
      .get(providerMessageId, eventStatus);

    if (existing) {
      // A webhook may have already inserted an unreconciled row for this
      // exact (provider_message_id, event_status) pair — backfill
      // auth_code_id onto it rather than inserting a duplicate logical
      // event (idempotency requirement, §5).
      if (existing.authCodeId == null) {
        db.prepare(`UPDATE whatsapp_delivery_events SET auth_code_id = ? WHERE id = ?`)
          .run(authCodeId, existing.id);
      }
      // Reconcile any OTHER unreconciled rows for this message ID
      // (different statuses, e.g. 'sent' arrived before this call).
      db.prepare(`
        UPDATE whatsapp_delivery_events SET auth_code_id = ?
        WHERE provider_message_id = ? AND auth_code_id IS NULL
      `).run(authCodeId, providerMessageId);
      return { id: existing.id };
    }

    const result = db
      .prepare(`
        INSERT INTO whatsapp_delivery_events
          (provider_message_id, phone_hash, auth_code_id, event_status, provider_error)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(providerMessageId, phoneHash, authCodeId, eventStatus, providerError);

    // Reconcile any OTHER already-persisted webhook rows for this message
    // ID (different statuses) that are still unreconciled.
    db.prepare(`
      UPDATE whatsapp_delivery_events SET auth_code_id = ?
      WHERE provider_message_id = ? AND auth_code_id IS NULL AND id != ?
    `).run(authCodeId, providerMessageId, result.lastInsertRowid);

    return { id: Number(result.lastInsertRowid) };
  }

  // Send-failure diagnostic event — provider_message_id is NULL by
  // definition here, so the partial unique index does not apply and this
  // is a plain insert (§5's explicit send-failure case).
  const result = db
    .prepare(`
      INSERT INTO whatsapp_delivery_events
        (provider_message_id, phone_hash, auth_code_id, event_status, provider_error)
      VALUES (NULL, ?, ?, ?, ?)
    `)
    .run(phoneHash, authCodeId, eventStatus, providerError);

  return { id: Number(result.lastInsertRowid) };
}

/**
 * Records a delivery-status webhook event (sent/delivered/read/failed).
 * May arrive before the corresponding recordSendResult() write — in that
 * case auth_code_id is inserted as NULL and backfilled later.
 *
 * Idempotent: a duplicate (provider_message_id, event_status) pair is a
 * no-op (Meta retrying the same webhook delivery does not create a
 * second logical record).
 *
 * @param {Object} params
 * @param {string} params.providerMessageId
 * @param {string} params.phoneHash
 * @param {string} params.eventStatus
 * @param {string|null} [params.providerError]
 * @param {string|null} [params.providerEventAt] - SQLite datetime string
 * @returns {{id: number|null, wasNewRow: boolean}}
 */
function recordStatusWebhook({ providerMessageId, phoneHash, eventStatus, providerError = null, providerEventAt = null }) {
  if (!providerMessageId) throw new Error('recordStatusWebhook: providerMessageId is required');
  if (!phoneHash) throw new Error('recordStatusWebhook: phoneHash is required');
  if (!eventStatus) throw new Error('recordStatusWebhook: eventStatus is required');

  const db = getDb();

  // Idempotency: if this exact logical event (same message ID + same
  // status) was already recorded — whether by an earlier webhook delivery
  // of the same event, or by recordSendResult() for 'send_accepted' — this
  // call is a no-op. Meta retrying the same webhook must not create a
  // duplicate logical record.
  const existing = db
    .prepare(`
      SELECT id FROM whatsapp_delivery_events
      WHERE provider_message_id = ? AND event_status = ?
    `)
    .get(providerMessageId, eventStatus);

  if (existing) {
    return { id: existing.id, wasNewRow: false };
  }

  // Look up any already-known auth_code_id for this message (from an
  // earlier recordSendResult() or a different-status recordStatusWebhook()
  // call) so a webhook arriving AFTER correlation exists still gets it
  // immediately, rather than waiting for a reconciliation pass that will
  // never come. If none exists yet, this is the early-arrival case (§5's
  // acceptance criterion) — insert with auth_code_id = NULL; it will be
  // backfilled the moment recordSendResult() runs for this message ID.
  const existingCorrelation = db
    .prepare(`
      SELECT auth_code_id AS authCodeId
      FROM whatsapp_delivery_events
      WHERE provider_message_id = ? AND auth_code_id IS NOT NULL
      LIMIT 1
    `)
    .get(providerMessageId);

  const authCodeId = existingCorrelation ? existingCorrelation.authCodeId : null;

  const result = db
    .prepare(`
      INSERT INTO whatsapp_delivery_events
        (provider_message_id, phone_hash, auth_code_id, event_status, provider_error, provider_event_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(providerMessageId, phoneHash, authCodeId, eventStatus, providerError, providerEventAt);

  return { id: Number(result.lastInsertRowid), wasNewRow: true };
}

/**
 * Test/diagnostic helper: returns all delivery events for a given
 * provider_message_id, ordered by id.
 *
 * @param {string} providerMessageId
 * @returns {Array<Object>}
 */
function getEventsByProviderMessageId(providerMessageId) {
  const db = getDb();
  return db
    .prepare(`
      SELECT id, provider_message_id AS providerMessageId, phone_hash AS phoneHash,
             auth_code_id AS authCodeId, event_status AS eventStatus,
             provider_error AS providerError, provider_event_at AS providerEventAt,
             received_at AS receivedAt, created_at AS createdAt
      FROM whatsapp_delivery_events
      WHERE provider_message_id = ?
      ORDER BY id ASC
    `)
    .all(providerMessageId);
}

/**
 * Test/diagnostic helper: returns all delivery events for a given
 * auth_code_id, ordered by id.
 *
 * @param {number} authCodeId
 * @returns {Array<Object>}
 */
function getEventsByAuthCodeId(authCodeId) {
  const db = getDb();
  return db
    .prepare(`
      SELECT id, provider_message_id AS providerMessageId, phone_hash AS phoneHash,
             auth_code_id AS authCodeId, event_status AS eventStatus,
             provider_error AS providerError, provider_event_at AS providerEventAt,
             received_at AS receivedAt, created_at AS createdAt
      FROM whatsapp_delivery_events
      WHERE auth_code_id = ?
      ORDER BY id ASC
    `)
    .all(authCodeId);
}

module.exports = {
  recordSendResult,
  recordStatusWebhook,
  getEventsByProviderMessageId,
  getEventsByAuthCodeId,
};
