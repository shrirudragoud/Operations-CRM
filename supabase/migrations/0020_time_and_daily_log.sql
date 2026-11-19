-- 0020 time tracking and the daily log (slices C and D)
-- 1. time_entry: time spent on a task, from a timer (start / stop) or typed in by hand. One running timer per
--    person: starting a new one stops the old one. A timer that is forgotten is capped at 12 hours.
--    People edit their own entries for 14 days; a task's managers and department leads see the time on it.
-- 2. Finishing or cancelling a task stops any timer running on it.
-- 3. daily_log: one short end-of-day note per person per day (what I did, what is next, what is blocking me),
--    read by the person and by the lead of their department.

-- ---------------------------------------------------------------- helpers
create or replace function ops.today_ist() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- Can the caller read this person's working notes? Themselves, the founder, or a lead sharing a department.
create or replace function ops.leads_staff(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_staff = auth.uid()
      or ops.is_founder()
      or (ops.my_role() = 'dept_lead'
          and exists (select 1 from ops.staff s
                      where s.id = p_staff and s.departments && ops.my_departments()))
$$;

-- Time can be tracked by internal people who can write; partners and viewers cannot.
create or replace function ops.can_track_time() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role not in ('viewer', 'partner') from ops.staff
                   where id = auth.uid() and is_active), false)
$$;

-- ---------------------------------------------------------------- time_entry
create table ops.time_entry (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null default auth.uid() references ops.staff (id) on delete cascade,
  task_id    uuid not null references ops.task (id) on delete cascade,
  source     text not null check (source in ('timer', 'manual')),
  work_date  date not null,
  started_at timestamptz,
  ended_at   timestamptz,
  minutes    integer check (minutes between 1 and 960),
  note       text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entry_shape check (
    (source = 'timer' and started_at is not null
       and ((ended_at is null and minutes is null) or (ended_at is not null and minutes is not null and ended_at > started_at)))
    or (source = 'manual' and started_at is null and ended_at is null and minutes is not null)
  )
);
create index time_entry_task_idx on ops.time_entry (task_id);
create index time_entry_staff_date_idx on ops.time_entry (staff_id, work_date);
create unique index time_entry_one_running_idx on ops.time_entry (staff_id) where source = 'timer' and ended_at is null;

create trigger t_time_entry_upd before update on ops.time_entry
  for each row execute function ops.touch_updated_at();

-- Close a running timer: ended_at is now, but never more than 12 hours after it started.
create or replace function ops.close_timer(p_id uuid, p_note_suffix text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; stop timestamptz;
begin
  select id, started_at, note into r from ops.time_entry where id = p_id and source = 'timer' and ended_at is null;
  if not found then return; end if;
  stop := least(now(), r.started_at + interval '12 hours');
  perform set_config('ops.system_job', '1', true);
  update ops.time_entry
     set ended_at = stop,
         minutes  = least(960, greatest(1, ceil(extract(epoch from (stop - r.started_at)) / 60)::integer)),
         note     = case when p_note_suffix is null then note
                         else left(coalesce(note || ' ', '') || p_note_suffix, 500) end
   where id = p_id;
  perform set_config('ops.system_job', '', true);
end $$;

create or replace function ops.time_entry_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  today date := ops.today_ist();
  total integer;
  r record;
begin
  if tg_op = 'INSERT' then
    if not ops.is_system() then
      new.staff_id := auth.uid();
      if not ops.can_track_time() then raise exception 'Only team members can track time'; end if;
    end if;
    if new.source = 'timer' then
      new.started_at := now();
      new.ended_at := null;
      new.minutes := null;
      new.work_date := ops.today_ist();
      for r in select id from ops.time_entry where staff_id = new.staff_id and source = 'timer' and ended_at is null loop
        perform ops.close_timer(r.id);
      end loop;
    else
      new.started_at := null;
      new.ended_at := null;
      if new.minutes is null then raise exception 'Enter how long you worked'; end if;
      if new.work_date is null then raise exception 'Pick the day you worked'; end if;
      if new.work_date > today then raise exception 'You can''t log time for a future day'; end if;
      if new.work_date < today - 30 and not ops.is_founder() then
        raise exception 'Time can only be logged for the last 30 days';
      end if;
    end if;
  else
    if new.staff_id is distinct from old.staff_id or new.task_id is distinct from old.task_id
       or new.source is distinct from old.source or new.started_at is distinct from old.started_at then
      raise exception 'Only the length, the day and the note of an entry can change';
    end if;
    if not ops.is_system() then
      if old.source = 'timer' and old.ended_at is null then
        -- stopping my timer: the database decides the end and the length
        if new.ended_at is not null then
          new.ended_at := least(now(), old.started_at + interval '12 hours');
          new.minutes := least(960, greatest(1, ceil(extract(epoch from (new.ended_at - old.started_at)) / 60)::integer));
        else
          new.minutes := null;
        end if;
        new.work_date := old.work_date;
      elsif old.source = 'timer' then
        new.ended_at := old.ended_at;
        new.minutes := old.minutes;
        new.work_date := old.work_date;
      else
        new.ended_at := null;
        if new.work_date > today then raise exception 'You can''t log time for a future day'; end if;
        if new.work_date < today - 30 and not ops.is_founder() then
          raise exception 'Time can only be logged for the last 30 days';
        end if;
      end if;
    end if;
  end if;

  if new.ended_at is not null or new.source = 'manual' then
    select coalesce(sum(minutes), 0) into total from ops.time_entry
     where staff_id = new.staff_id and work_date = new.work_date and id is distinct from new.id and minutes is not null;
    if total + coalesce(new.minutes, 0) > 1440 then
      raise exception 'That would be more than 24 hours on one day';
    end if;
  end if;
  return new;
end $$;
create trigger t_time_entry_guard before insert or update on ops.time_entry
  for each row execute function ops.time_entry_guard();

alter table ops.time_entry enable row level security;
create policy time_entry_sel on ops.time_entry for select to authenticated
  using (staff_id = (select auth.uid()) or (select ops.task_manager(task_id)) or (select ops.is_founder()));
create policy time_entry_ins on ops.time_entry for insert to authenticated
  with check ((select ops.can_track_time())
              and staff_id = (select auth.uid())
              and exists (select 1 from ops.task t where t.id = task_id));
create policy time_entry_upd on ops.time_entry for update to authenticated
  using (staff_id = (select auth.uid())
         and (work_date >= (select ops.today_ist()) - 14 or (source = 'timer' and ended_at is null))
         and (select ops.can_track_time()))
  with check (staff_id = (select auth.uid()));
create policy time_entry_del on ops.time_entry for delete to authenticated
  using ((staff_id = (select auth.uid()) and work_date >= (select ops.today_ist()) - 14 and (select ops.can_track_time()))
         or (select ops.is_founder()));

-- A finished or cancelled task has no timer running on it.
create or replace function ops.stop_timers_on_finish() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from ops.time_entry where task_id = new.id and source = 'timer' and ended_at is null loop
    perform ops.close_timer(r.id);
  end loop;
  return null;
end $$;
create trigger t_task_stop_timers after update of status on ops.task
  for each row when (new.status in ('done', 'cancelled') and old.status is distinct from new.status)
  execute function ops.stop_timers_on_finish();

-- ---------------------------------------------------------------- daily log
create table ops.daily_log (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null default auth.uid() references ops.staff (id) on delete cascade,
  log_date   date not null,
  did        text not null check (char_length(btrim(did)) between 1 and 4000),
  next_up    text check (next_up is null or char_length(next_up) <= 2000),
  blockers   text check (blockers is null or char_length(blockers) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, log_date)
);
create index daily_log_date_idx on ops.daily_log (log_date);

create trigger t_daily_log_upd before update on ops.daily_log
  for each row execute function ops.touch_updated_at();

create or replace function ops.daily_log_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare today date := ops.today_ist();
begin
  if tg_op = 'INSERT' then
    if not ops.is_system() then
      new.staff_id := auth.uid();
      if not ops.can_track_time() then raise exception 'Only team members can write a daily log'; end if;
    end if;
    if new.log_date > today then raise exception 'You can''t write the log for a future day'; end if;
    if new.log_date < today - 7 then raise exception 'The daily log can only be written for the last 7 days'; end if;
  else
    if new.staff_id is distinct from old.staff_id or new.log_date is distinct from old.log_date then
      raise exception 'The person and the day of a log can''t change';
    end if;
  end if;
  new.did := btrim(new.did);
  new.next_up := nullif(btrim(coalesce(new.next_up, '')), '');
  new.blockers := nullif(btrim(coalesce(new.blockers, '')), '');
  return new;
end $$;
create trigger t_daily_log_guard before insert or update on ops.daily_log
  for each row execute function ops.daily_log_guard();

alter table ops.daily_log enable row level security;
create policy daily_log_sel on ops.daily_log for select to authenticated
  using ((select ops.leads_staff(staff_id)));
create policy daily_log_ins on ops.daily_log for insert to authenticated
  with check ((select ops.can_track_time()) and staff_id = (select auth.uid()));
create policy daily_log_upd on ops.daily_log for update to authenticated
  using (staff_id = (select auth.uid()) and log_date >= (select ops.today_ist()) - 7 and (select ops.can_track_time()))
  with check (staff_id = (select auth.uid()));
create policy daily_log_del on ops.daily_log for delete to authenticated
  using (staff_id = (select auth.uid()) and log_date >= (select ops.today_ist()) - 7 and (select ops.can_track_time()));

-- ---------------------------------------------------------------- automation: stale timers
create or replace function ops.close_stale_timers() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id from ops.time_entry
           where source = 'timer' and ended_at is null and started_at < now() - interval '12 hours' loop
    perform ops.close_timer(r.id, '(stopped automatically after 12 hours)');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function ops.run_task_automation() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare made integer; sent integer; stopped integer;
begin
  made := ops.run_task_recurrences();
  sent := ops.run_task_reminders();
  stopped := ops.close_stale_timers();
  return jsonb_build_object('created', made, 'reminders', sent, 'timers_stopped', stopped);
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.task_manager(uuid), ops.is_watching(uuid) to authenticated, service_role;
grant execute on function ops.leads_staff(uuid), ops.can_track_time(), ops.today_ist() to authenticated, service_role;
grant execute on function ops.run_task_automation() to authenticated, service_role;
