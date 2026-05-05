-- Stores the user's preferred feed filter set as a URL search-param string
-- (e.g. "remote=true&seniority=mid,senior&visa_fit=Strong"). Applied automatically
-- when the user opens /dashboard with no query params.
ALTER TABLE "public"."profiles"
  ADD COLUMN IF NOT EXISTS "default_feed_filters" text;
