-- 0041: what the scheduled clean-up job needs to keep Storage tidy (see scripts/purge-task-files.mjs).
--  * ops.list_unregistered_task_objects: objects that were uploaded but never registered (the browser closed, or the
--    registration failed and the discard did not run). Anything newer than p_older_than is left alone, so an upload
--    that is still in flight is never touched.
--  * ops.task_files_deletable: of the paths a job is about to delete, the ones with no attachment row at all. This is
--    the safety net: the job asks the database before every delete, so an object that still backs a file is kept.
-- Both are for the service role only. Neither changes any data.

create or replace function ops.list_unregistered_task_objects(p_older_than interval default interval '24 hours', p_limit integer default 500)
returns setof text
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.is_system() then raise exception 'Only the scheduled job can list stray files' using errcode = '42501'; end if;
  if p_older_than is null or p_older_than < interval '1 hour' then raise exception 'Leave uploads younger than an hour alone'; end if;
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Ask for between 1 and 1000 files'; end if;
  if to_regclass('storage.objects') is null then return; end if;
  return query execute
    'select o.name from storage.objects o
      where o.bucket_id = ''task-files'' and o.created_at < now() - $1
        and not exists (select 1 from ops.task_attachment a where a.path = o.name)
        and not exists (select 1 from ops.task_file_orphan q where q.path = o.name)
      order by o.created_at limit $2'
    using p_older_than, p_limit;
end $$;

create or replace function ops.task_files_deletable(p_paths text[]) returns setof text
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.is_system() then raise exception 'Only the scheduled job can do this' using errcode = '42501'; end if;
  return query
    select p from unnest(coalesce(p_paths, '{}')) as p
     where not exists (select 1 from ops.task_attachment a where a.path = p);
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.list_unregistered_task_objects(interval, integer), ops.task_files_deletable(text[]) to service_role;
