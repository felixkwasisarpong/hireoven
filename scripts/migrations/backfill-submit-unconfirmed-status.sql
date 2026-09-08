-- The first live auto-apply run recorded four completed applications as plain
-- failures. The old code emitted 'submit_not_confirmed' both when no submit
-- control was found and when one was clicked without a receipt, so these rows
-- cannot be resolved either way after the fact — which is exactly what the
-- 'submitted_unconfirmed' status is for.
--
-- Re-bucketing them also makes them count against the nightly and weekly caps
-- (limits.ts now counts this status alongside 'applied'), so an application
-- that may already have reached an employer cannot be silently re-spent.
UPDATE apex_auto_apply_log
   SET status = 'submitted_unconfirmed'
 WHERE status = 'failed'
   AND error = 'submit_not_confirmed';
