-- Track the last time a user was active in the dashboard.
-- Updated by POST /api/user/activity (throttled: only writes if > 5 min since last update).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

-- Index for the admin users query that sorts/filters by recency.
CREATE INDEX IF NOT EXISTS idx_profiles_last_active_at ON profiles (last_active_at DESC NULLS LAST);
