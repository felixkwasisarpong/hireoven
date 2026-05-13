-- Adds the JSONB `score_breakdown` column on job_match_scores so the batch
-- scorer can persist matched/missing skills + gate triggers per row. The
-- schema.sql file already declares this column in CREATE TABLE plus a separate
-- ALTER, but databases provisioned before that line was added are missing it,
-- causing INSERTs to fail with: column "score_breakdown" does not exist.
--
-- Safe to run repeatedly (IF NOT EXISTS).

ALTER TABLE job_match_scores
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
