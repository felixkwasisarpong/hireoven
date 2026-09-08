-- Points the Sep 1 draft that was generated while image storage was down at
-- its checked-in public hero image.

UPDATE blog_posts
SET hero_image_url = '/blog/generated/c143e64d-996d-423b-89c8-44f0a6fb19d4/hero.webp',
    hero_image_key = 'public/blog/generated/c143e64d-996d-423b-89c8-44f0a6fb19d4/hero.webp',
    hero_image_alt = COALESCE(NULLIF(hero_image_alt, ''), title || ' illustration')
WHERE id = 'c143e64d-996d-423b-89c8-44f0a6fb19d4'::uuid
  AND (
    hero_image_url IS NULL OR hero_image_url = '' OR
    hero_image_key IS NULL OR hero_image_key = ''
  );
