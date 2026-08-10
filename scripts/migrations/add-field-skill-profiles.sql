-- Data-derived skill profiles per career field, for corpus-grounded resume
-- signal detection. Each row = one field with the skills its real jobs most
-- commonly list (share = fraction of that field's jobs listing the skill).
-- Refreshed by api/cron/refresh-field-profiles.

CREATE TABLE IF NOT EXISTS field_skill_profiles (
  field_key    TEXT        PRIMARY KEY,
  label        TEXT        NOT NULL,
  job_count    INTEGER     NOT NULL DEFAULT 0,
  skills       JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- [{ "skill": "...", "share": 0.42 }]
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
