-- First-run dashboard product tour completion marker.
-- NULL means the user has not completed/dismissed the tour yet.
ALTER TABLE "public"."profiles"
  ADD COLUMN IF NOT EXISTS "product_tour_seen_at" timestamp with time zone;
