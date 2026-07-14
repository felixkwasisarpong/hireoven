-- Run against your Hireoven Postgres (Coolify / self-hosted).
-- Adds blog_categories and blog_posts tables for AI-generated content.

CREATE TABLE IF NOT EXISTS blog_categories (
  id           serial PRIMARY KEY,
  slug         text UNIQUE NOT NULL,
  name         text NOT NULL,
  description  text NOT NULL,
  day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 5) -- 1=Mon … 5=Fri
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     integer     NOT NULL REFERENCES blog_categories(id) ON DELETE CASCADE,
  slug            text        UNIQUE NOT NULL,
  title           text        NOT NULL,
  excerpt         text        NOT NULL,
  body            text        NOT NULL, -- HTML, AI-generated
  seo_description text,
  hero_image_url  text,
  hero_image_key  text,
  hero_image_alt  text,
  image_prompt    text,
  reading_time    integer,              -- estimated minutes
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'published')),
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_category   ON blog_posts (category_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status     ON blog_posts (status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published  ON blog_posts (published_at DESC) WHERE status = 'published';

-- Seed the five categories (one per weekday)
INSERT INTO blog_categories (slug, name, description, day_of_week) VALUES
  ('h1b-visa-intel',     'H1B & Visa Intel',     'H1B cap news, USCIS policy updates, employer sponsorship data, and visa timeline intelligence',  1),
  ('job-market-pulse',   'Job Market Pulse',      'Hiring surges, layoffs, salary benchmarks, and remote-vs-on-site shifts across tech',             2),
  ('career-strategy',    'Career Strategy',       'Resume tips, cold outreach tactics, ATS optimization, and negotiation frameworks',                 3),
  ('tech-company-watch', 'Tech Company Watch',    'Who is hiring or freezing at big tech, growth-stage startups, and mid-size engineering teams',     4),
  ('interview-offers',   'Interview & Offers',    'Interview formats, preparation tactics, offer evaluation, comp negotiation, and common traps',     5)
ON CONFLICT (slug) DO NOTHING;
