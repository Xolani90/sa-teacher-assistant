# Next Session

Update **only this file** at the end of every session. This is the first
thing to open at the start of the next one — it exists to kill the "where
were we?" problem, so keep it short and current rather than comprehensive.

---

**Current branch:** main
**Last commit:** `4483866` (docs/project layer, pushed to `origin/main`, base `dd6ec21`)
**Last completed:**
- `docs/project/` documentation layer complete (9 files, including
  `PROJECT_MANIFEST.md` as index and `RELEASE_CHECKLIST.md` as release gate)
- Full evidence audit (Phase A): every page in `dashboard/src/pages/` traced
  to backend route + service + tests; `App.jsx` route table read directly
- Confirmed real gap: no standalone Learners list page/route exists (not a
  documentation miss — genuinely absent, decide if it's wanted before building)

**Current task:** Evidence audit (Phase A) is complete — see
`PROJECT_INVENTORY.md` for full evidence blocks on every page. Next up:
Phase B, browser verification (see `PROJECT_ROADMAP.md` "Immediate" section)

**Next steps:**
1. Decide whether a standalone Learners list is actually wanted (confirmed
   missing — not a bug, a genuine open question) before building it
2. Open Classes page live, confirm real data renders, log result in
   `VERIFIED.md`
3. Open Class Detail, confirm both detail and snapshot sections render
4. Resolve the ADR-014 vs. `VERIFIED.md` discrepancy (see
   `PROJECT_DECISIONS.md` — was class snapshot actually verified before, or
   not?)
5. Open Learner Detail, confirm timeline renders
6. Re-verify Observation Detail with an actual browser click-through, not
   just seeded test data
7. Record every mismatch found here before fixing anything, so nothing gets
   silently reworked mid-session

**Blocked by:** nothing

**Known active bugs (don't re-diagnose from scratch, resume from here):**
- Item analysis zeroing out (`averageFacilityValue`, `averageDiscrimination`,
  `Target group size`) — hypothesis is a `question_data` field-name
  mismatch between `assessmentCaptureService.js` (write) and
  `itemAnalysisService.js` (read). Not yet confirmed which field names
  actually differ — that's the next concrete step if picked up.
- Intervention plan AI (`fullInterventionPlan.js`) restates group counts
  incorrectly — prompt lets the model restate a number it should just be
  given directly.

**Do NOT repeat:**
- ✓ OTP flow fixed and browser-verified (PR24)
- ✓ Vite dev proxy / `VITE_API_BASE_URL` misconfiguration fixed
- ✓ Confirmed Classes/ClassDetail/LearnerDetail are real wiring, not mocks —
  no need to re-audit this, move straight to browser verification
- ✓ Confirmed zero frontend test files exist — don't rediscover this, it's
  already in `PROJECT_ROADMAP.md` as a backlog item
