-- =============================================================================
-- Hireoven - Seed Data: 20 Real Companies
-- =============================================================================

INSERT INTO companies (
  name, domain, industry, size, careers_url, ats_type,
  sponsors_h1b, sponsorship_confidence,
  h1b_sponsor_count_1yr, h1b_sponsor_count_3yr,
  is_active
) VALUES

-- Big Tech
(
  'Google', 'google.com', 'Technology', 'enterprise',
  'https://careers.google.com', 'custom',
  true, 95, 8200, 24000, true
),
(
  'Meta', 'meta.com', 'Technology', 'enterprise',
  'https://www.metacareers.com', 'custom',
  true, 95, 3100, 9400, true
),
(
  'Apple', 'apple.com', 'Technology', 'enterprise',
  'https://jobs.apple.com', 'custom',
  true, 92, 2800, 8200, true
),
(
  'Microsoft', 'microsoft.com', 'Technology', 'enterprise',
  'https://jobs.careers.microsoft.com', 'icims',
  true, 95, 6500, 19000, true
),
(
  'Amazon', 'amazon.com', 'Technology', 'enterprise',
  'https://www.amazon.jobs', 'custom',
  true, 95, 9800, 28000, true
),

-- High-Growth Startups / Scale-ups
(
  'Stripe', 'stripe.com', 'Fintech', 'large',
  'https://stripe.com/jobs', 'greenhouse',
  true, 88, 420, 1100, true
),
(
  'Linear', 'linear.app', 'Technology', 'startup',
  'https://linear.app/careers', 'ashby',
  false, 40, 12, 30, true
),
(
  'Vercel', 'vercel.com', 'Technology', 'startup',
  'https://vercel.com/careers', 'ashby',
  true, 72, 85, 210, true
),
(
  'Notion', 'notion.so', 'Technology', 'medium',
  'https://www.notion.so/careers', 'greenhouse',
  true, 78, 140, 380, true
),
(
  'Figma', 'figma.com', 'Technology', 'large',
  'https://www.figma.com/careers', 'greenhouse',
  true, 82, 290, 780, true
),
(
  'Anthropic', 'anthropic.com', 'Artificial Intelligence', 'medium',
  'https://www.anthropic.com/careers', 'greenhouse',
  true, 85, 210, 480, true
),
(
  'OpenAI', 'openai.com', 'Artificial Intelligence', 'medium',
  'https://openai.com/careers', 'greenhouse',
  true, 87, 380, 860, true
),

-- Finance
(
  'JPMorgan Chase', 'jpmorganchase.com', 'Finance', 'enterprise',
  'https://careers.jpmorgan.com', 'workday',
  true, 90, 4200, 12500, true
),
(
  'Goldman Sachs', 'goldmansachs.com', 'Finance', 'enterprise',
  'https://www.goldmansachs.com/careers', 'workday',
  true, 88, 1800, 5400, true
),

-- Healthcare
(
  'CVS Health', 'cvshealth.com', 'Healthcare', 'enterprise',
  'https://jobs.cvshealth.com', 'workday',
  true, 75, 980, 2800, true
),
(
  'UnitedHealth Group', 'unitedhealthgroup.com', 'Healthcare', 'enterprise',
  'https://careers.unitedhealthgroup.com', 'workday',
  true, 80, 1400, 4100, true
),

-- Retail / Consumer
(
  'Nike', 'nike.com', 'Retail', 'enterprise',
  'https://jobs.nike.com', 'workday',
  true, 73, 620, 1700, true
),
(
  'Airbnb', 'airbnb.com', 'Travel & Hospitality', 'large',
  'https://careers.airbnb.com', 'greenhouse',
  true, 83, 520, 1450, true
),

-- Cloud / Infrastructure
(
  'Cloudflare', 'cloudflare.com', 'Technology', 'large',
  'https://www.cloudflare.com/careers', 'greenhouse',
  true, 80, 380, 1020, true
),
(
  'Databricks', 'databricks.com', 'Technology', 'large',
  'https://www.databricks.com/company/careers', 'greenhouse',
  true, 86, 860, 2300, true
);
