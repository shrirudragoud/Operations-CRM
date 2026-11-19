-- 0021: 0018 added task_created_by_idx, but the foreign-key index task_created_by_fkey_ix already covers ops.task (created_by).
-- The Performance Advisor flags the pair as a duplicate.
drop index if exists ops.task_created_by_idx;
