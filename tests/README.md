# Tests

Run everything: `node tests/run-all.js`

`run-all.js` auto-discovers every `*.js` file in this directory (except
itself) and runs each as its own child process, alphabetically. No
registration step is needed for new test files — dropping a file in here
is enough.

## Yoco webhook signature coverage

Two files cover `POST /payment/webhook`:

### `yocoWebhookVerifier.test.js`
- Unit tests for `utils/yocoWebhookVerifier.js`, the pure function
  extracted from the route handler.
- No database, no server, no I/O.
- Covers: valid signature, tampered payload, wrong signature, replay
  attack (stale timestamp), missing headers, malformed secret (bad
  prefix / empty payload), missing secret, and multiple signature
  entries in one `webhook-signature` header (relevant during Yoco/Svix
  secret rotation).
- Fast (milliseconds) — always runs.

### `payment-webhook-smoke.test.js`
- Integration test. Spawns the real `server.js` as a child process on a
  random port with a throwaway `DB_PATH` (deleted on exit) and an
  isolated `YOCO_WEBHOOK_SECRET`, so it never touches the real database
  or production secret.
- Sends a validly-signed webhook (expects HTTP 200 and no rejection log
  line) and a badly-signed one (expects HTTP 200 — the route acks
  before verifying — but a logged `reason=invalid_signature`).
- Proves the HTTP → verifier → handler wiring end-to-end; it does not
  re-test the six rejection branches, since the unit tests already
  cover those deterministically.
- Slower, and depends on `better-sqlite3` being built for the current
  platform. **Skipped by default.** Run with:

  ```bash
  RUN_SMOKE_TESTS=1 node tests/payment-webhook-smoke.test.js
  # or, as part of the full suite:
  RUN_SMOKE_TESTS=1 node tests/run-all.js
  ```

  Without `RUN_SMOKE_TESTS=1` it prints `SKIPPED: ...` and exits 0, so
  it never counts as a failure in a lightweight or CI environment that
  hasn't built the native module.
