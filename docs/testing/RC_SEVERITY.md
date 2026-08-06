# RC Severity Standard

Canonical severity definitions for all Release Candidate (RC) sign-off
workflows. Every workflow's Findings Register references this document
instead of redefining severity locally, so "Major" (etc.) means the same
thing in Authentication, Classes, Learners, Assessments, Reports/PDF, QMS,
and Observations.

## Critical
Stop the audit immediately. Do not proceed to the remaining steps in the
current workflow or move on to the next workflow until resolved.

- Security/auth bypass, or a protected route reachable while logged out or
  after logout
- Cross-teacher data leakage (one teacher's JWT/phoneHash returns another
  teacher's data — a violation of the 404-not-403 ownership pattern)
- Data loss or data corruption
- Incorrect learner data displayed as correct (e.g. wrong marks, wrong
  facility/discrimination values, wrong group sizes)
- Server 500 on a core read path
- Uncaught console exception during a core flow
- Audit cannot meaningfully continue past this point

## Major
Log and continue the current workflow, but this blocks RC sign-off.

- A feature is unusable (button/action does nothing, page fails to load
  for a valid case)
- Incorrect calculations that don't rise to Critical (e.g. a derived
  metric wrong but not learner-identity-affecting)
- Broken navigation (dead links, wrong redirect targets)
- Incorrect PDF output (wrong content, missing sections, malformed file)
- Wrong dashboard state (e.g. stale data shown, wrong loading/error state)
- Incorrect HTTP status code for a documented case (e.g. 500 instead of
  404, 200 instead of 422)

## Minor
Log and continue. Does not block RC sign-off on its own, but is tracked
in the Findings Register for later cleanup.

- Copy/wording issues
- Layout/spacing/cosmetic issues
- Timing quirks (spinner shows too long/short, no functional impact)
- Non-blocking UI glitches

## Usage
Every workflow's Findings Register cites severity from this list only.
Do not introduce workflow-specific severity language. If a finding
doesn't clearly fit one of the three categories, default to the higher
severity and note the ambiguity in the Description field.
