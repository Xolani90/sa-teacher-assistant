# Next Session

Update **only this file** at the end of every session. This is the first
thing to open at the start of the next one — it exists to kill the "where
were we?" problem, so keep it short and current rather than comprehensive.

(Earlier handoff content — the 2026-08-06 Phase B browser-verification
steps and the 2026-08-10 post-RC1 reconciliation handoff — is complete and
superseded. Its history lives in `ACTIVE_WORK.md`,
`docs/testing/RC1_SIGNOFF.md`, and `docs/releases/RC1-MILESTONE.md`, not
duplicated here, per this file's own purpose of staying short.)

---

**Current branch:** main (clean, fully pushed — `origin/main..main` = 0)
**Last commit:** `a06f7e8` — "docs: correct stale ADR-012 status — QMS
Action Centre already implemented"

**Where the project actually is:** RC1 is closed. Work is on **RC2**, which
has been running as a numbered sequence of priorities:

- **RC2 P1 — pilot menu discoverability** (`3ab093f`): done. M1 (`MY
  RESOURCES` exposed under "My progress & account"), M2 ("Create a new
  blueprint"), M3 ("Class-wide intervention overview") all routed through
  the existing `reDispatchAsText` dispatch pattern — no duplicated logic.
  M4 corrected `RC1-MILESTONE.md`'s stale "No dashboard yet" line and
  logged live dashboard verification as an open follow-up. **That M4
  follow-up is the thread still running.**
- **RC2 P2 — zero-capital AI fallback** (`752b8b2`): done, documented in
  `docs/governance/RC2-P2-zero-capital-ai-fallback.md`. New
  `services/aiAvailability.js` classifies AI failures so a teacher with no
  API key configured gets a truthful "AI generation unavailable" message
  plus the genuinely-working deterministic commands, instead of a "please
  try again" that can never succeed. No second provider, no offline model,
  no new retries.
- **RC2 P3 — dashboard live end-to-end verification**: **in progress.**
  Checklist at `docs/governance/RC2-P3-dashboard-live-verification-checklist.md`
  (`a73afab`). P3's audit also caught ADR-012's status line claiming the
  QMS Action Centre was unimplemented when it had already shipped
  (`a06f7e8`).

**Current task:** finish RC2 P3.

Progress this session (2026-09-09) — logged in the checklist's
"Verification log" section:
- Live deployment reachable (`/healthz` 200, SPA shell served at `/`).
- Confirmed the deployed bundle is built from current `main`, so the
  checklist verifies today's code and not a stale deploy.
- API auth boundary verified live: all 21 GET endpoints return 401
  unauthenticated; garbage, wrong-scheme, empty, wrong-secret, expired,
  and unsigned `alg: none` tokens are all rejected.
- Confirmed no teacher data reaches an unauthenticated visitor — inner SPA
  URLs return only the 401-byte shell, no server-side rendering path.

**Next steps:**
1. The rest of RC2 P3 — the authenticated browser pass. **This is blocked
   on the operator, not on engineering:** every remaining box needs a real
   teacher session (real phone, real WhatsApp OTP against production).
   Work through the checklist top to bottom in a browser, using disposable
   test records for the destructive boxes.
2. Only after every box is genuinely observed: sign off P3, update
   `RC1-MILESTONE.md`'s dashboard note, and close the RC2 P1 M4 follow-up.
3. Then pick RC2 P4 from the RC2 Backlog in `RC1-MILESTONE.md`
   (localisation, dashboard PR29–32 analytics/QMS/reporting, analytics
   enhancements, advanced coaching, AI capability improvements) — plus the
   `auth_codes` retention/archival decision deferred out of RC1-H-003.

**Blocked by:** RC2 P3's authenticated boxes need the operator's own
browser login. Nothing else is blocked.

**Do NOT repeat:**
- ✓ RC-1 audit — do not re-run W1–W7 or reopen `RC1_SIGNOFF.md`.
- ✓ RC2 P1 menu routing — verified; don't re-scope the three menu items.
- ✓ RC2 P2 AI fallback — implemented; don't re-add retries or propose a
  second provider/offline model, both explicitly out of scope.
- ✓ QMS Action Centre (ADR-012) — already implemented in `a9f660a`; the
  ADR's old "not yet implemented" status was the bug, not the feature.
- ✓ Unauthenticated dashboard/API security probing — done live 2026-09-09,
  clean. Re-probing adds nothing; the open gap is authenticated behavior.
- ✓ Searching the deployed bundle for the copy quoted in `1c95ea5`'s
  commit message — those strings are source comments only, stripped by
  minification. Its absence is not evidence of a stale deploy.
