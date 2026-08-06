# Next Session

Update **only this file** at the end of every session. This is the first
thing to open at the start of the next one — it exists to kill the "where
were we?" problem, so keep it short and current rather than comprehensive.

---

**Current branch:** unknown — no `.git` in this archive, confirm locally
**Last completed:**
- `docs/project/` documentation layer created (6 files): PROJECT_STATUS,
  PROJECT_INVENTORY, VERIFIED, PROJECT_ROADMAP, PROJECT_DECISIONS,
  CHANGELOG_PROJECT
- Repo audit confirming Classes/ClassDetail/LearnerDetail frontend pages
  are genuinely wired to real backend endpoints

**Current task:** Browser verification pass (see `PROJECT_ROADMAP.md`
"Immediate" section)

**Next steps:**
1. Open Classes page live, confirm real data renders, log result in
   `VERIFIED.md`
2. Open Class Detail, confirm both detail and snapshot sections render
3. Resolve the ADR-014 vs. `VERIFIED.md` discrepancy (see
   `PROJECT_DECISIONS.md` — was class snapshot actually verified before, or
   not?)
4. Open Learner Detail, confirm timeline renders
5. Re-verify Observation Detail with an actual browser click-through, not
   just seeded test data
6. Record every mismatch found here before fixing anything, so nothing gets
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
