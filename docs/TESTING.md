# Testing Guidelines

This project has no test framework (no Jest/Mocha) — see
`tests/run-all.js`. Each test file is a plain Node script with its own
pass/fail counter, run in its own child process via
`node tests/<name>.test.js` or `npm test`.

## Database-backed tests

Tests that exercise production database code must use the shared test
database helper:

```
tests/helpers/createTestDb.js
```

Do not define inline SQLite schemas (`CREATE TABLE ...`) for tests that
execute production services, repositories, routes, or utilities that
normally run against the project's migrated database.

### Why

The shared helper runs the project's real migration chain
(`runMigrations()` in `utils/database.js`) before each test. Using the
real schema:

- prevents schema drift between tests and production
- ensures new migrations are exercised automatically
- catches foreign key and `NOT NULL` constraint differences
- avoids maintaining duplicate table definitions
- keeps production-backed tests consistent

Background and audit history for the cleanup that established this
convention are documented in:

```
docs/TSE_SCHOOL_CALENDAR_TEST_GAP.md
```

## Appropriate use of inline schemas

Inline schemas are acceptable only for self-contained unit tests that:

- do not execute production database code,
- intentionally simulate a small isolated state machine or algorithm,
- do not depend on `utils/database` or repository/service implementations.

If a test imports production code that normally uses the application
database, use `createTestDb()` instead.

## Pattern

`createTestDb()` **must be required first** in the file, before any
service, repository, or route module — it installs a `better-sqlite3`
shim (this sandbox can't compile the native addon) that those modules'
own internal `require('better-sqlite3')` calls need to pick up. Requiring
it later silently leaves other modules bound to the real, uncompiled
addon.

```js
'use strict';

// MUST be the very first require in the file.
const { createTestDb } = require('./helpers/createTestDb');
const testDb = createTestDb(__filename);
const db = testDb.db;

// Now safe to require services/repositories/routes as normal — their
// internal require('../utils/database') resolves through the same
// migrated test db.
const { someFunction } = require('../services/someService');

// ... test logic, using `check(condition, label)` per the existing
// convention in tests/*.test.js ...

testDb.cleanup();
```

Always call `testDb.cleanup()` on every exit path, including inside a
`.catch()` handler for async test files — otherwise the throwaway
`.tmp-db` file is left behind.

If the test also needs to stub a non-database module (e.g.
`services/whatsappService`, `services/aiService`), do that with the same
`require.cache` + `Module._resolveFilename` override pattern used
elsewhere in `tests/`, applied *after* `createTestDb()`. `createTestDb()`
only shims `better-sqlite3` — it doesn't touch application services.

## When adding new migrations

If a new database migration is added:

- production-backed tests should require no schema updates;
- any failure in a `createTestDb()`-based test should indicate a genuine
  incompatibility between the test and the new migration, not duplicated
  test-schema drift.
