SA Teacher Assistant — Project Manifest
========================================

Current Phase
-------------
Phase 3: Integration & Browser Verification
(Phase 1 architecture and Phase 2 services are mostly complete per
PROJECT_STATUS.md — "mostly" because completeness there is itself unverified
in the browser sense; see that file for specifics, not this summary.)

Single Source of Truth
-----------------------
PROJECT_STATUS.md — if any other file in this directory disagrees with it,
PROJECT_STATUS.md wins; go fix the other file.

Read in this order
-------------------
1. PROJECT_STATUS.md    — current facts, measured counts
2. NEXT_SESSION.md      — where to resume right now
3. RELEASE_CHECKLIST.md — what's gating a release candidate
4. VERIFIED.md           — evidence log of what's actually been proven live
5. PROJECT_DECISIONS.md — architectural decisions, quick reference
6. PROJECT_ROADMAP.md   — remaining work only
7. PROJECT_INVENTORY.md — full per-feature detail with file-level evidence
8. CHANGELOG_PROJECT.md — milestone history

Architecture
------------
docs/adr/ — 21 ADR/design documents. Index at docs/adr/ADR-INDEX.md.

Current Priority
-----------------
Browser verification of already-implemented features. See
RELEASE_CHECKLIST.md for the exact list of unchecked boxes.

Do NOT build new features until the Release Checklist is complete, unless a
critical defect requires it (current exceptions in flight: the item-analysis
zeroing bug and the intervention-plan AI prompt bug — both are defects in
already-shipped features, not new work, so they're allowed to proceed in
parallel with the verification pass).

Known open discrepancy
-----------------------
ADR-014 claims class snapshot was verified against seeded data; the
release-checklist standard requires an actual browser click-through. Not yet
resolved — see PROJECT_DECISIONS.md. Don't tick that RELEASE_CHECKLIST row
until it's resolved one way or the other.

Caveat on this manifest
-------------------------
No .git directory exists in the working archive this documentation layer was
built from, so no commit hash is recorded anywhere in these docs. Anyone
picking this up from a real clone should confirm PROJECT_STATUS.md's header
against `git log` and `git status` before trusting anything here as current.
