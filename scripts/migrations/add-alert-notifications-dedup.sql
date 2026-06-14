-- Instant-notification dedup. The pipeline code inserts a `notification_type`
-- and relies on ON CONFLICT (user_id, job_id, notification_type), but prod had
-- neither the column nor a unique index — so dedup was a no-op. This adds both
-- so the harvester-driven /api/cron/instant-notify can reprocess overlapping
-- windows without double-notifying. Idempotent.

ALTER TABLE public.alert_notifications
  ADD COLUMN IF NOT EXISTS notification_type TEXT;

-- Existing rows predate the column; default them so the unique index covers them.
UPDATE public.alert_notifications
   SET notification_type = 'alert'
 WHERE notification_type IS NULL;

-- Collapse any pre-existing duplicates before adding the unique index, keeping
-- one row per (user, job, type).
DELETE FROM public.alert_notifications a
 USING public.alert_notifications b
 WHERE a.ctid < b.ctid
   AND a.user_id = b.user_id
   AND a.job_id = b.job_id
   AND a.notification_type IS NOT DISTINCT FROM b.notification_type;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_alert_notifications_user_job_type
  ON public.alert_notifications (user_id, job_id, notification_type)
  WHERE user_id IS NOT NULL AND job_id IS NOT NULL;
