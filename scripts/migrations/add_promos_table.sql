-- Promos: admin-managed promotional cards shown in the dashboard sidebar.
-- Only one promo is shown at a time — the most recently activated one
-- that falls within its active window.

CREATE TABLE IF NOT EXISTS promos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,          -- big headline e.g. "40% bonus"
  subtitle      text NOT NULL,          -- subheading e.g. "University student offer"
  description   text NOT NULL,          -- body copy
  badge_label   text NOT NULL DEFAULT 'Premium',
  is_new        boolean NOT NULL DEFAULT false,
  theme         text NOT NULL DEFAULT 'orange',  -- orange | blue | green | purple
  icon          text NOT NULL DEFAULT 'sparkles', -- sparkles | graduation | gift | zap | star | rocket
  cta_label     text NOT NULL DEFAULT 'Learn more',
  cta_url       text NOT NULL,
  is_active     boolean NOT NULL DEFAULT false,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promos_active ON promos (is_active, starts_at, ends_at)
  WHERE is_active = true;
