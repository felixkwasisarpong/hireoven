-- Waitlist invite columns for controlled-access (waitlist-only) mode.
-- approved      : set by admin when they want to invite this person
-- invite_token  : UUID sent in the signup link; consumed on account creation
-- invited_at    : when the invite email was sent
-- invite_used_at: when the token was redeemed (account created)

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS approved       BOOLEAN   DEFAULT false,
  ADD COLUMN IF NOT EXISTS invite_token   TEXT      UNIQUE,
  ADD COLUMN IF NOT EXISTS invited_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_waitlist_invite_token
  ON waitlist (invite_token)
  WHERE invite_token IS NOT NULL;
