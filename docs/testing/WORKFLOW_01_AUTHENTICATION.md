# Workflow 1: Authentication & Login — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W1 – Authentication & Login |
| Git Branch | |
| Git Commit | |
| Dashboard Version | |
| API Commit (if different) | |
| Environment | ☐ Local Dev ☐ Staging ☐ Production |
| Executed By | |
| Date | |

## Implementation Coverage
- WhatsApp-phone-based OTP auth: `request-code` → `verify-code` (`routes/auth.js`, `authCodeRepository.js`, HMAC-SHA256 OTP hashing, per ADR-008/PR22).
- Per-teacher JWT issued on successful verification; `requireTeacherAuth` middleware gates all `routes/api.js` endpoints.

## Preconditions
Test phone number already exists as a teacher record (has sent ≥1
WhatsApp message, triggering `ensureTeacher`). If not, send one test
message first.

## Environment Notes
Local dev returns `devOtp` directly in the `request-code` response body
— read it from the Network tab.

## Stop Conditions
**Critical:**
- Phone enumeration (known vs. unknown phone produces different response)
- Authentication bypass
- Protected route accessible while logged out, or after logout
- Missing/incorrect Authorization header on authenticated calls
- Server 500 during any auth step
- Uncaught console exception during the auth flow

**Non-blocking:** cosmetic UI, spinner/timing, copy, minor layout.

## Functional Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W1-01 | 1.1 | Navigate to dashboard while logged out | Redirected to /login | — | ☐ |
| W1-02 | 1.2 | Enter known phone, submit | Advances to code step | request-code status: ___ · devOtp present: Y/N | ☐ |
| W1-03 | 1.3 | Enter correct devOtp, submit | Redirected to / | verify-code status: ___ · expiresIn: ___ · teacher.id: ___ · teacher.name: ___ | ☐ |
| W1-04 | 1.3a | Check Network tab immediately after landing on / | Both calls 200, teacher-scoped data, Bearer header present | /api/classes status: ___ · /api/learners status: ___ · Authorization header present: Y/N | ☐ |
| W1-05 | 1.4 | Refresh page while logged in | Stays logged in, name still shown | — | ☐ |
| W1-06 | 1.5 | Log out via sidebar | Redirected to /login, localStorage cleared | sa_teacher_token present after logout: Y/N · sa_teacher_info present after logout: Y/N | ☐ |
| W1-07 | 1.5a | Trigger authenticated call immediately after logout | Returns 401, no stale/cached data | Status: ___ | ☐ |
| W1-08 | 1.5b | Click browser Back after logout | No protected content revealed | Behavior observed: ___ | ☐ |
| W1-09 | 1.6 | Visit /classes directly while logged out | Redirected to /login | — | ☐ |
| W1-10 | 1.7 | Submit incorrect code | Stays on code step, error shown | verify-code status: ___ | ☐ |
| W1-11 | 1.8 | Click "Use a different number" | Returns to phone step, fields cleared | — | ☐ |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W1-S1 | S1 | Enter unknown phone, submit | Identical response shape to W1-02, no devOtp | request-code status: ___ · devOtp present: Y/N (must be N) | ☐ |
| W1-S2 | S2 | Submit incorrect code 6× | 6th attempt still 401, no crash | Final attempt status: ___ | ☐ |
| W1-S3 | S3 (optional) | Expired OTP verification | 401 | Status: ___ | ☐ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W1-12 | 1.9 | Inspect console through full login→authed call→logout→back sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Clean: Y/N (attach screenshot if N) | ☐ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W1-T1 | T1 | Observe latency and button/spinner states | Reasonable latency, correct loading states | Optional |

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| | | | | | |

## Workflow Result
- Functional: ☐ Pass ☐ Fail
- Security: ☐ Pass ☐ Fail
- Console: ☐ Clean ☐ Issues found
- Critical findings: ___
- Major findings: ___
- Minor findings: ___
- Retests required: ___
- Execution time: ___ minutes
- Overall: ☐ PASS ☐ FAIL
- Reason (if FAIL): ___

## Carry Forward
WF2 (Classes) prerequisites: ___ (or "None")

## Sign-off
- Workflow Executed By: __________
- Date: __________
- Git Commit / Branch: __________
- Environment: ☐ Local Dev ☐ Staging ☐ Production
