-- 0039: files on tasks (docs/BUSINESS_RULES.md "Task files").
-- 1. A private Storage bucket `task-files`: 25 MB per file, images and documents only. Object path is
--    `<task id>/<uuid>/<safe file name>`. The browser uploads straight to Storage with a signed upload URL; the
--    server then checks the real bytes and calls ops.register_task_attachment(). A file that was never registered is
--    just an object nobody can see in the app.
-- 2. ops.task_attachment: one row per registered file, optionally tied to a comment, optionally an inline image
--    (shown inside the description). Written only through the RPCs below. Removing is a soft delete that anyone
--    who may edit the task can undo until ops.purge_task_attachments() makes it final.
-- 3. ops.task.attachment_count and comment_count, kept by triggers, so a card never has to count rows.
-- 4. ops.task_file_orphan: paths whose row is gone (purged, or the task was deleted). A service job removes
--    the objects from Storage, then calls ops.ack_task_file_orphans().
-- 5. Storage rules call ops.task_file_object_ok() so they live in one place and are tested in PGlite.

-- ---------------------------------------------------------------- who may edit a task (mirrors task_upd)
create or replace function ops.can_edit_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ops.can_write()
     and exists (select 1 from ops.task t
                 where t.id = p_task
                   and (t.department = any (ops.my_departments())
                        or t.assignee_id = auth.uid()
                        or t.created_by = auth.uid()
                        or ops.is_task_owner(t.id)
                        or (t.department is null
                            and (ops.is_founder() or ops.leads_task_assignee(t.assignee_id) or ops.leads_task_owners(t.id)))))
$$;

-- ---------------------------------------------------------------- history kinds
alter table ops.task_history drop constraint task_history_kind_check;
alter table ops.task_history add constraint task_history_kind_check
  check (kind in ('created', 'assigned', 'status', 'due', 'start', 'priority', 'department', 'edited',
                  'file_added', 'file_removed', 'file_restored'));

-- ---------------------------------------------------------------- counters on the task
alter table ops.task
  add column attachment_count int not null default 0 check (attachment_count >= 0),
  add column comment_count    int not null default 0 check (comment_count >= 0);

alter table ops.task disable trigger t_task_upd;
update ops.task t set comment_count = c.n
  from (select task_id, count(*)::int as n from ops.task_comment group by task_id) c
 where c.task_id = t.id;
alter table ops.task enable trigger t_task_upd;

create or replace function ops.task_comment_count_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_task uuid := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
begin
  update ops.task set comment_count = (select count(*)::int from ops.task_comment where task_id = v_task)
   where id = v_task;
  return null;
end $$;
create trigger t_task_comment_count after insert or delete on ops.task_comment
  for each row execute function ops.task_comment_count_sync();

-- ---------------------------------------------------------------- the files
create table ops.task_attachment (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references ops.task (id) on delete cascade,
  comment_id  uuid references ops.task_comment (id) on delete set null,
  path        text not null unique
              check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$'
                 and left(path, 36) = task_id::text),
  name        text not null check (char_length(btrim(name)) between 1 and 160),
  mime        text not null check (mime in (
                'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'text/csv', 'text/plain', 'text/markdown')),
  size_bytes  int not null check (size_bytes between 1 and 26214400),
  kind        text not null check (kind in ('image', 'document') and ((kind = 'image') = (mime like 'image/%'))),
  is_inline   boolean not null default false check (not is_inline or kind = 'image'),
  uploaded_by uuid references ops.staff (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references ops.staff (id) on delete set null,
  check (deleted_by is null or deleted_at is not null)
);
create index task_attachment_task_idx on ops.task_attachment (task_id, created_at);
create index task_attachment_comment_idx on ops.task_attachment (comment_id);
create index task_attachment_uploader_idx on ops.task_attachment (uploaded_by);
create index task_attachment_deleted_by_idx on ops.task_attachment (deleted_by);
create index task_attachment_deleted_at_idx on ops.task_attachment (deleted_at) where deleted_at is not null;

alter table ops.task_attachment enable row level security;
-- Whoever reads the task in full sees its files. A removed file shows only to its uploader and to people who may edit the task.
create policy task_attachment_sel on ops.task_attachment for select to authenticated
  using ((select ops.sees_task_fully(task_id))
         and (deleted_at is null or uploaded_by = (select auth.uid()) or (select ops.can_edit_task(task_id))));

create or replace function ops.task_attachment_count_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_task uuid := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
begin
  update ops.task set attachment_count = (select count(*)::int from ops.task_attachment where task_id = v_task and deleted_at is null)
   where id = v_task;
  return null;
end $$;
create trigger t_task_attachment_count after insert or update of deleted_at or delete on ops.task_attachment
  for each row execute function ops.task_attachment_count_sync();

-- ---------------------------------------------------------------- paths to clean out of Storage
create table ops.task_file_orphan (
  path      text primary key,
  queued_at timestamptz not null default now()
);
create index task_file_orphan_queued_idx on ops.task_file_orphan (queued_at);
alter table ops.task_file_orphan enable row level security;
create policy task_file_orphan_sel on ops.task_file_orphan for select to authenticated
  using ((select ops.is_founder()));

create or replace function ops.task_attachment_orphan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into ops.task_file_orphan (path) values (old.path) on conflict do nothing;
  return null;
end $$;
create trigger t_task_attachment_orphan after delete on ops.task_attachment
  for each row execute function ops.task_attachment_orphan();

-- ---------------------------------------------------------------- RPCs
-- Registers an uploaded file. The caller must have uploaded the object already (checked here when Storage exists).
-- On the task itself: anyone who may edit the task. On a comment: the comment's own author, who may read the task.
create or replace function ops.register_task_attachment(
  p_task uuid, p_path text, p_name text, p_mime text, p_size int,
  p_comment uuid default null, p_inline boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid;
  v_name  text := btrim(coalesce(p_name, ''));
  v_kind  text;
  v_size  bigint := p_size;
  v_found boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to add files' using errcode = '42501'; end if;
  if p_task is null or not ops.sees_task_fully(p_task) then raise exception 'That task was not found'; end if;
  if not ops.can_write() then raise exception 'You do not have access to add files' using errcode = '42501'; end if;

  if p_comment is null then
    if not ops.can_edit_task(p_task) then
      raise exception 'You cannot add files to this task' using errcode = '42501';
    end if;
  elsif not exists (select 1 from ops.task_comment c
                     where c.id = p_comment and c.task_id = p_task and c.author_id = auth.uid()) then
    raise exception 'You can only attach files to your own comment on this task';
  end if;

  if coalesce(p_path, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$'
     or left(p_path, 36) <> p_task::text then
    raise exception 'The file must be stored in this task''s own folder';
  end if;
  if char_length(v_name) not between 1 and 160 then raise exception 'A file name must be 1 to 160 characters'; end if;
  v_kind := case when coalesce(p_mime, '') like 'image/%' then 'image' else 'document' end;
  if coalesce(p_mime, '') not in (
       'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'text/csv', 'text/plain', 'text/markdown') then
    raise exception 'That file type is not allowed. Use an image, PDF, Word, Excel, PowerPoint, CSV, text or Markdown file';
  end if;
  if coalesce(p_inline, false) and v_kind <> 'image' then raise exception 'Only an image can be placed inside the description'; end if;

  if to_regclass('storage.objects') is not null then
    execute 'select true, (metadata ->> ''size'')::bigint from storage.objects where bucket_id = ''task-files'' and name = $1'
      into v_found, v_size using p_path;
    if not coalesce(v_found, false) then raise exception 'The file was not uploaded. Try again'; end if;
    v_size := coalesce(v_size, p_size);
  end if;
  if coalesce(v_size, 0) not between 1 and 26214400 then raise exception 'Each file must be between 1 byte and 25 MB'; end if;

  perform 1 from ops.task where id = p_task for update;
  if (select count(*) from ops.task_attachment where task_id = p_task and deleted_at is null) >= 100 then
    raise exception 'A task can hold at most 100 files. Remove one first';
  end if;

  insert into ops.task_attachment (task_id, comment_id, path, name, mime, size_bytes, kind, is_inline, uploaded_by)
  values (p_task, p_comment, p_path, v_name, p_mime, v_size::int, v_kind, coalesce(p_inline, false), auth.uid())
  returning id into v_id;

  insert into ops.task_history (task_id, actor_id, kind, to_value) values (p_task, auth.uid(), 'file_added', left(v_name, 160));
  return v_id;
end $$;

-- Takes a file off the task (soft delete). The uploader, or anyone who may edit the task.
create or replace function ops.remove_task_attachment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if auth.uid() is null then raise exception 'Sign in to remove files' using errcode = '42501'; end if;
  select x.* into a from ops.task_attachment x where x.id = p_id;
  if not found or not ops.sees_task_fully(a.task_id) then raise exception 'That file was not found'; end if;
  if not ops.can_write() or not (a.uploaded_by = auth.uid() or ops.can_edit_task(a.task_id)) then
    raise exception 'You cannot remove this file' using errcode = '42501';
  end if;
  if a.deleted_at is not null then raise exception 'That file is already removed'; end if;
  update ops.task_attachment set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  insert into ops.task_history (task_id, actor_id, kind, from_value) values (a.task_id, auth.uid(), 'file_removed', left(a.name, 160));
end $$;

create or replace function ops.restore_task_attachment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if auth.uid() is null then raise exception 'Sign in to restore files' using errcode = '42501'; end if;
  select x.* into a from ops.task_attachment x where x.id = p_id;
  if not found or not ops.sees_task_fully(a.task_id) then raise exception 'That file was not found'; end if;
  if not ops.can_write() or not (a.uploaded_by = auth.uid() or ops.can_edit_task(a.task_id)) then
    raise exception 'You cannot restore this file' using errcode = '42501';
  end if;
  if a.deleted_at is null then raise exception 'That file is not removed'; end if;
  perform 1 from ops.task where id = a.task_id for update;
  if (select count(*) from ops.task_attachment where task_id = a.task_id and deleted_at is null) >= 100 then
    raise exception 'A task can hold at most 100 files. Remove one first';
  end if;
  update ops.task_attachment set deleted_at = null, deleted_by = null where id = p_id;
  insert into ops.task_history (task_id, actor_id, kind, to_value) values (a.task_id, auth.uid(), 'file_restored', left(a.name, 160));
end $$;

-- Service job: makes removals older than p_days final and returns the Storage paths waiting to be deleted.
create or replace function ops.purge_task_attachments(p_days integer default 30) returns setof text
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.is_system() then raise exception 'Only the scheduled job can purge files' using errcode = '42501'; end if;
  if p_days is null or p_days < 0 then raise exception 'Give the number of days to keep removed files'; end if;
  delete from ops.task_attachment where deleted_at is not null and deleted_at < now() - make_interval(days => p_days);
  return query select o.path from ops.task_file_orphan o order by o.queued_at limit 1000;
end $$;

-- Service job: the objects at these paths are gone from Storage.
create or replace function ops.ack_task_file_orphans(p_paths text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not ops.is_system() then raise exception 'Only the scheduled job can do this' using errcode = '42501'; end if;
  delete from ops.task_file_orphan where path = any (coalesce(p_paths, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- Storage rules
-- p_mode: 'read', 'write' (upload) or 'delete'. Called from the policies on storage.objects.
-- Reading and uploading need the same access as the comments: read the task in full (a person who only holds a
-- subtask is out) and not be a viewer. Whether the upload is then registered on the task or on a comment is
-- decided by the RPC. A registered file's object can never be deleted from the browser; a removed file's object
-- can be read only by who can still see its row.
create or replace function ops.task_file_object_ok(p_name text, p_mode text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_task uuid;
begin
  if auth.uid() is null or p_name is null then return false; end if;
  if p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$' then
    return false;
  end if;
  v_task := left(p_name, 36)::uuid;
  if not ops.sees_task_fully(v_task) then return false; end if;

  if p_mode = 'read' then
    return not exists (select 1 from ops.task_attachment a
                        where a.path = p_name and a.deleted_at is not null
                          and not (a.uploaded_by = auth.uid() or ops.can_edit_task(a.task_id)));
  end if;
  if not ops.can_write() then return false; end if;
  if p_mode = 'delete' then
    return not exists (select 1 from ops.task_attachment a where a.path = p_name);
  end if;
  return p_mode = 'write';
end $$;

do $do$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('task-files', 'task-files', false, 26214400, array[
      'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/csv', 'text/plain', 'text/markdown'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
  if to_regclass('storage.objects') is not null then
    drop policy if exists task_files_read on storage.objects;
    drop policy if exists task_files_insert on storage.objects;
    drop policy if exists task_files_delete on storage.objects;
    create policy task_files_read on storage.objects for select to authenticated
      using (bucket_id = 'task-files' and (select ops.task_file_object_ok(name, 'read')));
    create policy task_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'task-files' and (select ops.task_file_object_ok(name, 'write')));
    create policy task_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'task-files' and (select ops.task_file_object_ok(name, 'delete')));
  end if;
end
$do$;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema ops from public;
grant execute on function
  ops.can_edit_task(uuid), ops.task_file_object_ok(text, text),
  ops.register_task_attachment(uuid, text, text, text, int, uuid, boolean),
  ops.remove_task_attachment(uuid), ops.restore_task_attachment(uuid) to authenticated, service_role;
grant execute on function ops.purge_task_attachments(integer), ops.ack_task_file_orphans(text[]) to service_role;
