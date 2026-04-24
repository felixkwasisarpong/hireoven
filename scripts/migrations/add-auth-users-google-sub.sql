ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_google_sub_unique
  ON auth.users (google_sub)
  WHERE google_sub IS NOT NULL;
