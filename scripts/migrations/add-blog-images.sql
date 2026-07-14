-- Adds generated hero image metadata for AI-generated blog posts.

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS hero_image_key text,
  ADD COLUMN IF NOT EXISTS hero_image_alt text,
  ADD COLUMN IF NOT EXISTS image_prompt text;
