# Curriculum Data Gaps

Status: Open — Backlog
Type: Reference data gap (not an architectural decision, not a defect)
Discovered: During ADR-014 Dashboard Snapshot real-data validation

## Summary

`CAPS_TOPICS`, the reference dataset backing curriculum coverage calculations,
only contains topics for Grades 7–12. There is no Foundation Phase (R–3) or
Intermediate Phase (4–6) curriculum data. Any class in Grades R–6 cannot have
its coverage computed, which caps mastery escalation and shows as missing
data in analytics and the dashboard. This was discovered while validating
the Class Snapshot feature against real seeded data (Grade 6B Mathematics),
not through a bug report.

## Confirmed Findings

- `CAPS_TOPICS` currently begins at Grade 7 across all subjects.
- Grades R–6 curriculum datasets are entirely absent — no partial data, no
  placeholder entries.
- Subject coverage varies even within the supported range:
  - Mathematics, English, History, Geography: Grades 7–12
  - Natural Sciences: Grades 7–9 only
  - Physical Sciences, Life Sciences: Grades 10–12 only
- Confirmed present in code: `services/blueprintTopicValidation.js`,
  `services/curriculumCoverageService.js`,
  `services/curriculumIntelligenceService.js`, `services/coverageService.js`,
  `utils/database.js`.

## Affected Grades

- Foundation Phase: R, 1, 2, 3 — no data
- Intermediate Phase: 4, 5, 6 — no data
- Senior Phase (7–9) and FET (10–12) — covered, with the Natural/Physical/Life
  Sciences exceptions noted above

## Affected Subjects

- All subjects are affected for Grades R–6, since no Foundation or
  Intermediate Phase dataset exists at all.
- Within the covered grade bands, Natural Sciences, Physical Sciences, and
  Life Sciences have narrower ranges than Mathematics, English, History, and
  Geography (see above).

## Affected Services

- `curriculumIntelligenceService`
- `curriculumCoverageService`
- `coverageService`
- `blueprintTopicValidation`
- `masteryService` — coverage-driven escalation is capped when coverage
  cannot be computed
- `classInterventionService` — intervention signals that depend on coverage
  inherit the gap
- `classAnalyticsService`
- Dashboard Snapshot Analytics card (ADR-013/ADR-014) — renders coverage as
  unavailable (dash) rather than a number for affected classes

## User Impact

- Teachers of Grades R–6 classes see coverage as unavailable in the class
  snapshot and analytics views, even when they have active learners and
  assessment data.
- Mastery figures for these classes are based only on assessment
  performance, without the coverage-driven escalation that Grade 7–12
  classes benefit from.
- No incorrect or misleading numbers are shown — the gap presents as an
  honest "no data" state, not a wrong calculation.

## Why This Is Not a Defect

- All affected services are behaving correctly given their inputs.
- The missing curriculum reference data — not a bug in coverage logic —
  is what prevents the calculation.
- The Dashboard Snapshot's fault-isolation design (ADR-014) is working as
  intended here: it reports the unavailable section honestly rather than
  fabricating or defaulting to misleading values.

## Acceptance Criteria

- [ ] Populate `CAPS_TOPICS` with Foundation Phase (R–3) datasets for all
      relevant subjects.
- [ ] Populate `CAPS_TOPICS` with Intermediate Phase (4–6) datasets for all
      relevant subjects.
- [ ] Verify `coverageService` and `curriculumCoverageService` calculations
      against the new data for at least one seeded R–6 class per phase.
- [ ] Verify mastery progression/escalation behaves correctly once coverage
      is available for these grades.
- [ ] Update regression tests (`test-atp-topic-alignment.js` and related
      suites) to cover Grades R–6.
- [ ] Confirm the Dashboard Snapshot Analytics card renders real coverage
      values (not dashes) for affected classes once data is populated.

## Future Work

- Determine authoritative CAPS source documents for Foundation and
  Intermediate Phase per subject, matching the structure already used for
  Grades 7–12 in `CAPS_TOPICS`.
- Decide whether Natural/Physical/Life Sciences grade-range gaps (7–9 vs
  10–12 split) should also be closed as part of the same effort or tracked
  separately.
- Re-run the Class Snapshot real-data validation (as done for Grade 6B
  Mathematics) against a Foundation Phase class once data is in place.

## Priority

Medium. Not blocking current dashboard work (analytics correctly degrade),
but should be resolved before the product is positioned as covering the
full CAPS curriculum, since Grades R–6 represent a large share of South
African classrooms.
