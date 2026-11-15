-- 0011 archive: soft delete for institutions, deals and events (decision D21).
-- Records are archived, not deleted, so history (audit log, stock movements, KPIs) stays intact.
-- Screens hide archived rows by default (`archived_at is null`); restoring clears the stamp.
alter table ops.institution
  add column archived_at timestamptz,
  add column archived_by uuid references ops.staff(id);
alter table ops.deal
  add column archived_at timestamptz,
  add column archived_by uuid references ops.staff(id);
alter table ops.event
  add column archived_at timestamptz,
  add column archived_by uuid references ops.staff(id);

create index institution_archived_by_fkey_ix on ops.institution (archived_by);
create index deal_archived_by_fkey_ix on ops.deal (archived_by);
create index event_archived_by_fkey_ix on ops.event (archived_by);
-- lists show active rows only, so keep that path cheap
create index institution_active_idx on ops.institution (name) where archived_at is null;
create index deal_active_idx on ops.deal (stage, expected_close) where archived_at is null;
create index event_active_idx on ops.event (starts_at) where archived_at is null;

-- Who may archive/restore, and what must be finished first. auth.uid() is null (service role,
-- SQL editor, migrations) bypasses the role check like the other guards in 0007.
create or replace function ops.guard_archive() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.archived_at is not distinct from old.archived_at then
    return new;
  end if;

  if auth.uid() is not null and ops.my_role() not in ('founder', 'dept_lead') then
    raise exception 'Only a founder or department lead can archive or restore records';
  end if;

  if new.archived_at is not null and old.archived_at is null then
    if tg_table_name = 'institution' then
      if exists (select 1 from ops.deal d where d.institution_id = new.id
                 and d.archived_at is null and d.stage in ('meeting','proposal','negotiation')) then
        raise exception 'Close or archive the institution''s open deals first';
      end if;
      if exists (select 1 from ops.event e where e.institution_id = new.id
                 and e.archived_at is null and e.status in ('scheduled','in_progress')) then
        raise exception 'Cancel or complete the institution''s scheduled events first';
      end if;
    elsif tg_table_name = 'deal' then
      if new.stage in ('meeting','proposal','negotiation') then
        raise exception 'Mark the deal won or lost before archiving it';
      end if;
    elsif tg_table_name = 'event' then
      if new.status in ('scheduled','in_progress') then
        raise exception 'Cancel or complete the event before archiving it';
      end if;
    end if;
    new.archived_by := auth.uid();
  elsif new.archived_at is null then
    new.archived_by := null;
  end if;
  return new;
end $$;

create trigger t_institution_archive before update of archived_at on ops.institution
  for each row execute function ops.guard_archive();
create trigger t_deal_archive before update of archived_at on ops.deal
  for each row execute function ops.guard_archive();
create trigger t_event_archive before update of archived_at on ops.event
  for each row execute function ops.guard_archive();

-- new functions get PUBLIC execute by default; remove it (see 0010 section 1)
revoke execute on all functions in schema ops from public;
