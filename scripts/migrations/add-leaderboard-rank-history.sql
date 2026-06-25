-- Spec 08 follow-up — weekly leaderboard rank snapshots so the digest can show real
-- week-over-week "biggest movers". One row per company per ISO week, captured from
-- h1b_leaderboard_mv. Movers = prev_week_rank - current_week_rank (positive = up).

CREATE TABLE IF NOT EXISTS leaderboard_rank_history (
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  iso_week       TEXT NOT NULL,            -- '2026-W26'
  rank_volume    INTEGER,
  rank_cert_rate INTEGER,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, iso_week)
);

CREATE INDEX IF NOT EXISTS lrh_week_volume_idx ON leaderboard_rank_history (iso_week, rank_volume);
