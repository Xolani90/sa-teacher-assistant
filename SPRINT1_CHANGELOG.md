# Sprint 1 Change Log

## Overview
Sprint 1 addresses critical and high-priority issues identified in the Phase 1 Audit Report. All fixes are minimal, targeted corrections that preserve existing behavior while resolving the identified defects.

## Changes Made

### 1. Grade Parsing Fix (C-1) - Critical
**Files:** `services/onboardingService.js`, `routes/webhook.js`, `utils/database.js`

**Issue:** `parseGradeInput()` returned formatted string "Grade N" instead of integer. This broke two consumers:
- `curriculumCoverageService.js` line 248: `parseInt(teacher.grade)` returned NaN
- `curriculumIntelligenceService.js` line 282: `parseInt(profile.grade)` returned NaN

**Fix:** 
- Changed `parseGradeInput()` to return integer (1-12) directly instead of formatted string
- Updated `routes/webhook.js` profile update message to format as "Grade N" for display
- Added Migration 019 in `utils/database.js` to convert existing "Grade N" strings to integers

**Migration:** `UPDATE teachers SET grade = CAST(SUBSTR(grade, 7) AS INTEGER) WHERE grade LIKE 'Grade %'`
- Idempotent: only affects rows matching the "Grade N" pattern
- Safe to re-run on subsequent startups

**Safety:** Display formatting preserved via template strings. Migration handles existing data compatibility.

---

### 2. Webhook Response/Throw Cleanup (C-2) - High
**File:** `utils/verifyWebhook.js`

**Issue:** All three rejection branches sent `res.status().json()` then threw. This caused Express error handler to attempt double response, triggering spurious Sentry alerts on ordinary webhook rejections.

**Fix:** Removed `res.status().json()` calls from all three rejection branches. The verify callback now only throws to reject the request; Express error handler handles the response.

**Safety:** Express's built-in error handling middleware already sends appropriate error responses. This eliminates the double-response anti-pattern while preserving security behavior.

---

### 3. SQL Parameterization (H-1) - High
**File:** `utils/usageTracker.js`

**Issue:** `getTeachersExpiringWithin()` used string interpolation for the `days` parameter in SQL: `datetime('now', '+${days} days')`.

**Fix:** Changed to parameterized query using SQLite binding: `datetime('now', '+' || ? || ' days')` with `.all(days)`.

**Safety:** Current call site uses hardcoded literal (3), so no current exploit risk. This prevents future SQL injection if the function is called with user-derived values.

---

### 4. JSON.parse Hardening (M-2) - Medium
**File:** `services/interventionPlanService.js`

**Issue:** `generateInterventionSummary()` had unguarded `JSON.parse(plan.strategies)` on line 301-302.

**Fix:** Wrapped JSON.parse in try/catch block. On parse failure, logs error and falls back to empty array.

**Safety:** Current callers pass self-generated JSON from the same function, so risk is low. This future-proofs the function against malformed DB-loaded data.

---

### 5. Remove Obsolete Exports (H-2) - Medium
**Files:** `utils/usageTracker.js`, `routes/webhook.js`

**Issue:** `checkUsageOnly` and `incrementUsage` were still exported but not used anywhere. These are the pre-TOCTOU-fix split-check functions that could reintroduce the race condition if accidentally used.

**Fix:** Removed both functions from `usageTracker.js` exports and their imports from `webhook.js`. Functions remain defined in the file but are no longer accessible.

**Safety:** Codebase-wide grep confirmed no other call sites exist. The atomic `checkAndIncrementUsage` is the correct function and remains in use.

---

## Regression Review Results

### C-1 (Grade Parsing)
- ✅ No remaining call sites expect "Grade N" string format
- ✅ All display locations updated to format integers as "Grade N"
- ✅ Migration 019 handles existing "Grade N" data in database
- ✅ No public API contract changes (parseGradeInput is internal)

### C-2 (Webhook Response/Throw)
- ✅ Function signature unchanged (verifyWebhookSignature)
- ✅ No public API impact (internal Express middleware callback)
- ✅ Security behavior preserved (still rejects invalid signatures)

### H-1 (SQL Parameterization)
- ✅ Function signature unchanged (getTeachersExpiringWithin)
- ✅ Single call site verified (server.js line 423)
- ✅ No behavior change for valid input

### M-2 (JSON.parse Hardening)
- ✅ Function signature unchanged (generateInterventionSummary)
- ✅ No behavior change for valid input
- ✅ Only adds defensive error handling

### H-2 (Remove Obsolete Exports)
- ✅ No remaining imports of removed functions
- ✅ Functions still defined but not exported (no breaking change)
- ✅ All call sites use checkAndIncrementUsage

## Testing
- Existing test `tests/phase-e-usage-rollback.test.js` validates the atomic usage-checking behavior (uses `checkAndIncrementUsage`)
- No test changes required as fixes are defensive hardening and data contract corrections
- Migration 019 is idempotent and safe to re-run

## Impact Assessment
- **Breaking changes:** None (grade migration handles existing data, functions still defined)
- **Behavior changes:** Grade now stored correctly as integer, enabling curriculum features to work
- **Security improvements:** SQL parameterization, webhook response pattern cleanup
- **Code quality:** Removed dead code exports, added error handling
- **Database migration:** Required and provided (Migration 019)
