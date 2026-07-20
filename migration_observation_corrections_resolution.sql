-- Migration: observation corrections + resolved-followup flag
-- Adds the schema support needed for:
--   1. "Correct an observation" (supersedes model, not true UPDATE)
--   2. "Mark a follow-up as resolved"
--
-- Apply this alongside the existing observation_assessments /
-- observation_records tables from Phase 6.

ALTER TABLE observation_assessments
  ADD COLUMN corrects_assessment_id INTEGER REFERENCES observation_assessments(id);

ALTER TABLE observation_records
  ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_observation_assessments_corrects
  ON observation_assessments(corrects_assessment_id);
