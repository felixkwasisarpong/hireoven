-- Points the seven published posts that were generated without hero art at
-- checked-in public images. Keep this data migration idempotent so deploys can
-- safely run it after manual backfills.

WITH backfilled_images(id, hero_image_url, hero_image_key) AS (
  VALUES
    ('98f9ac54-dbae-4a14-ad10-a5c846ff5b36'::uuid, '/blog/generated/98f9ac54-dbae-4a14-ad10-a5c846ff5b36/hero.webp', 'public/blog/generated/98f9ac54-dbae-4a14-ad10-a5c846ff5b36/hero.webp'),
    ('39b69b6e-2797-4af7-a32c-6ba63cec8b05'::uuid, '/blog/generated/39b69b6e-2797-4af7-a32c-6ba63cec8b05/hero.webp', 'public/blog/generated/39b69b6e-2797-4af7-a32c-6ba63cec8b05/hero.webp'),
    ('b054baba-b88e-4597-8f7e-7162b797df96'::uuid, '/blog/generated/b054baba-b88e-4597-8f7e-7162b797df96/hero.webp', 'public/blog/generated/b054baba-b88e-4597-8f7e-7162b797df96/hero.webp'),
    ('8bdd8e82-3013-4cb5-a62a-21788056c879'::uuid, '/blog/generated/8bdd8e82-3013-4cb5-a62a-21788056c879/hero.webp', 'public/blog/generated/8bdd8e82-3013-4cb5-a62a-21788056c879/hero.webp'),
    ('885e5e03-e91c-4a69-a8fb-1ed22fb6a5fb'::uuid, '/blog/generated/885e5e03-e91c-4a69-a8fb-1ed22fb6a5fb/hero.webp', 'public/blog/generated/885e5e03-e91c-4a69-a8fb-1ed22fb6a5fb/hero.webp'),
    ('a26d9756-aee3-41d1-8d3d-2219d24915b0'::uuid, '/blog/generated/a26d9756-aee3-41d1-8d3d-2219d24915b0/hero.webp', 'public/blog/generated/a26d9756-aee3-41d1-8d3d-2219d24915b0/hero.webp'),
    ('59fdca0e-9185-44e9-8326-fe7244f00327'::uuid, '/blog/generated/59fdca0e-9185-44e9-8326-fe7244f00327/hero.webp', 'public/blog/generated/59fdca0e-9185-44e9-8326-fe7244f00327/hero.webp')
)
UPDATE blog_posts AS p
SET hero_image_url = backfilled_images.hero_image_url,
    hero_image_key = backfilled_images.hero_image_key,
    hero_image_alt = COALESCE(NULLIF(p.hero_image_alt, ''), p.title || ' illustration')
FROM backfilled_images
WHERE p.id = backfilled_images.id
  AND (
    p.hero_image_url IS NULL OR p.hero_image_url = '' OR
    p.hero_image_key IS NULL OR p.hero_image_key = ''
  );
