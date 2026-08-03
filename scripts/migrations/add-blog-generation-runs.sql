-- Audit table for scheduled/admin blog generation attempts.
-- Run after scripts/migrations/add_blog_tables.sql.

CREATE TABLE IF NOT EXISTS blog_generation_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status          text NOT NULL
                  CHECK (status IN ('success', 'skipped_weekend', 'skipped_existing', 'failed')),
  category_id     integer REFERENCES blog_categories(id) ON DELETE SET NULL,
  category_slug   text,
  blog_post_id    uuid REFERENCES blog_posts(id) ON DELETE SET NULL,
  title           text,
  image_generated boolean,
  image_error     text,
  duration_ms     integer,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_generation_runs_created
  ON blog_generation_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blog_generation_runs_status_created
  ON blog_generation_runs (status, created_at DESC);
