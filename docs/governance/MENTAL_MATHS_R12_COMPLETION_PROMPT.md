# Mental Maths R–12 Completion Prompt

Read `docs/governance/MENTAL_MATHS_ALL_GRADES_COMPLETION.md` and the current repository state, then take Mental Maths to genuine production completion for **Grades R–12**.

First audit everything already implemented and preserve technically sound work. Then establish the authoritative curriculum requirements for **each grade R–12** using only the repository's governing documents and specification evidence.

Treat repository-internal governance and specification documents (`ADRs`, `docs/specs/mental-maths/`, `docs/backlog/`) as the only authoritative evidence source. **Do not use general knowledge of CAPS or external search to fill a gap.** If a grade has no authorizing specification in this repository, report it as a gap — do not research or reconstruct one.

Implement all missing Mental Maths grades/features that are actually supported by the repository evidence, using the existing architecture and deterministic/canonical-answer approach. Extend generation, topic selection, difficulty, dispatch, WhatsApp/session flow, saving, answer keys, validation, and tests as required.

Maintain a running gap list grade-by-grade. If evidence is genuinely absent for a grade, record the gap and move to the next grade rather than inventing or reconstructing requirements.

For any requirement where authoritative evidence is conflicting, stop and identify the exact conflict and sources rather than choosing or fabricating a solution.

Run the complete Mental Maths test suite and relevant regression tests. Fix implementation/test failures that are within the supported requirements. Verify final coverage explicitly against **R–12**, not merely Grades 5/7/8.

Do not create or claim Project Owner approvals, freezes, governance decisions, or authorization acts. Do not rewrite governance history. Do not commit or push anything unless I explicitly authorize it.

At the end, report:
1. what was already implemented,
2. what you implemented,
3. exact grade-by-grade R–12 coverage,
4. what remains,
5. the running curriculum/evidence gaps,
6. tests run and results,
7. any conflicts or decisions requiring Project Owner input.
