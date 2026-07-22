-- Social proof: admin-managed testimonials and partner logos for /partners.
--
-- Both render on the public page only when is_published = true, ordered by
-- sort_order then created_at. Managed from /admin/testimonials.

CREATE TABLE IF NOT EXISTS testimonials (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote        TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  role         TEXT        NOT NULL,
  org          TEXT,
  avatar_url   TEXT,
  is_published BOOLEAN     NOT NULL DEFAULT false,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_testimonials_published
  ON testimonials (sort_order, created_at)
  WHERE is_published = true;

CREATE TABLE IF NOT EXISTS partners (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  logo_url     TEXT,
  url          TEXT,
  is_published BOOLEAN     NOT NULL DEFAULT false,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partners_published
  ON partners (sort_order, created_at)
  WHERE is_published = true;
