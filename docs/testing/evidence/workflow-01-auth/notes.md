# Workflow 1: Authentication & Login — Execution Notes

Checklist: [../../WORKFLOW_01_AUTHENTICATION.md](../../WORKFLOW_01_AUTHENTICATION.md)

Free-form execution notes, gotchas, and anything not captured by the
checklist's Record columns directly. Screenshots go in ./screenshots/,
raw network responses/HAR exports go in ./network/, console log
captures go in ./console/ — reference filenames here so the workflow
doc's Evidence field can point to a specific file.

## Session
- Date: 2026-08-06
- Executed by: Xolani Tshabalala
- Git commit: 92945af4bdd4e6514d2250649d2502aef43c5b8
- Environment: Local Dev (dashboard localhost:5173)

## Notes
- Lockout confirmed: 6th verify-code attempt still returned 401 even
  with the CORRECT code, i.e. MAX_ATTEMPTS enforcement is working.
- Logout confirmed to clear the actual token (not just React state) —
  refresh after logout stays on /login.
- Direct nav to /classes while logged out redirected with no flash of
  protected content.
- Findings: favicon.ico 404 (Minor/Cosmetic — no favicon.ico in
  dashboard/public). React Router v7 future-flag console warnings
  (Informational only — not a defect).
- Screenshots referenced below still need to be copied into
  ./screenshots/ from the local machine — see filenames in the
  Functional Validation table below.
