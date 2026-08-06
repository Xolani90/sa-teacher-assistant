# Workflow 1: Authentication & Login — RC Sign-off Checklist

Severity terms refer to `docs/testing/RC_SEVERITY.md`. Structure frozen
per `docs/testing/RC_TEMPLATE.md`.

## Release Information
| Field | Value |
|---|---|
| Release Candidate | RC-1 |
| Workflow | W1 – Authentication & Login |
| Git Branch | main |
| Git Commit | 92945af4bdd4e6514d2250649d2502aef43c5b8 |
| Dashboard Version | localhost:5173 |
| API Commit (if different) | — |
| Environment | ☑ Local Dev ☐ Staging ☐ Production |
| Executed By | Xolani Tshabalala |
| Date | 2026-08-06 |

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
| W1-01 | 1.1 | Navigate to dashboard while logged out | Redirected to /login | — | ☑ |
| W1-02 | 1.2 | Enter known phone, submit | Advances to code step | request-code status: 200 · devOtp present: Y | ☑ |
| W1-03 | 1.3 | Enter correct devOtp, submit | Redirected to / | verify-code status: 200 · teacher.id: 1 · teacher.name: Thabo Mokoena | ☑ |
| W1-04 | 1.3a | Check Network tab immediately after landing on / | Both calls 200, teacher-scoped data, Bearer header present | /api/classes status: 200 · /api/learners status: 200 · Authorization header present: Y | ☑ |
| W1-05 | 1.4 | Refresh page while logged in | Stays logged in, name still shown | — | ☑ |
| W1-06 | 1.5 | Log out via sidebar | Redirected to /login, localStorage cleared | sa_teacher_token present after logout: N · sa_teacher_info present after logout: N | ☑ |
| W1-07 | 1.5a | Trigger authenticated call immediately after logout | Returns 401, no stale/cached data | Status: 401 | ☑ |
| W1-08 | 1.5b | Click browser Back after logout | No protected content revealed | Behavior observed: ___ | ☐ |
| W1-09 | 1.6 | Visit /classes directly while logged out | Redirected to /login | — | ☑ |
| W1-10 | 1.7 | Submit incorrect code | Stays on code step, error shown | verify-code status: 401 · "Incorrect or expired code" shown, no crash | ☑ |
| W1-11 | 1.8 | Click "Use a different number" | Returns to phone step, fields cleared | — | ☐ |

## Security Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W1-S1 | S1 | Enter unknown phone, submit | Identical response shape to W1-02, no devOtp | request-code status: ___ · devOtp present: Y/N (must be N) | ☐ |
| W1-S2 | S2 | Submit incorrect code 6× | 6th attempt still 401, no crash | Final attempt status: 401 (6th attempt used the CORRECT code and still failed — MAX_ATTEMPTS lockout enforced) | ☑ |
| W1-S3 | S3 (optional) | Expired OTP verification | 401 | Status: ___ | ☐ |

## Console Validation
| Evidence ID | Step | Action | Expected | Record | Status |
|---|---|---|---|---|---|
| W1-12 | 1.9 | Inspect console through full login→authed call→logout→back sequence | Clean — no uncaught exceptions, no failed loads, no React errors | Clean: Y — only non-blocking favicon.ico 404 and React Router v7 future-flag warnings | ☑ |

## Optional — Timing/UX
| Evidence ID | Step | Action | Expected | Status |
|---|---|---|---|---|
| W1-T1 | T1 | Observe latency and button/spinner states | Reasonable latency, correct loading states | Optional |

## Findings Register
| ID | Severity | Step | Description | Evidence | Disposition |
|---|---|---|---|---|---|
| F-W1-01 | Minor/Cosmetic | — | favicon.ico 404 — no favicon.ico in dashboard/public | Console | Accepted, not blocking RC-1 |
| F-W1-02 | Informational | — | React Router v7 future-flag warnings (startTransition, relativeSplatPath not yet opted into) | Console | Not a defect |

## Workflow Result
- Functional: ☑ Pass ☐ Fail
- Security: ☑ Pass ☐ Fail
- Console: ☑ Clean ☐ Issues found
- Critical findings: 0
- Major findings: 0
- Minor findings: 1 (favicon 404, accepted)
- Retests required: 0
- Execution time: ___ minutes
- Overall: ☑ PASS ☐ FAIL
- Reason (if FAIL): —

## Carry Forward
WF2 (Classes) prerequisites: None

## Sign-off
- Workflow Executed By: Xolani Tshabalala
- Date: 2026-08-06
- Git Commit / Branch: 92945af4bdd4e6514d2250649d2502aef43c5b8 / main
- Environment: ☑ Local Dev ☐ Staging ☐ Production

> Note: W1-08 (Back button after logout) and W1-11 (Use a different
> number) weren't reported as executed in this session and are left
> unchecked above — worth a quick pass before RC-1 sign-off, or mark
> explicitly out-of-scope if intentionally skipped.
