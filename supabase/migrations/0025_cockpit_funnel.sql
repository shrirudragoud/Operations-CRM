-- 0025: the funnel the Cockpit reads.
--
--   1. v_funnel_steps   per segment, how many institutions have REACHED each step. Stages only move forward (0007), so
--                       "reached" is "current stage is this one or later". Churned institutions are left out of the
--                       steps (we do not know how far they got); v_funnel still lists them by stage.
--   2. ide_funnel()     student steps from the IDE sync (signed up, compiled, flashed, published). `connected` is false
--                       until the sync has sent anyone, so the Cockpit shows "not connected" instead of a made-up zero.
--                       A function, not a view, so a lead who cannot read student rows is not told "not connected".
--
-- Step names are the stage names; the "qualified", "signed" (deal_won) and "active" rules live in BUSINESS_RULES.md.

create view ops.v_funnel_steps with (security_invoker = true) as
select seg.segment, st.ord, st.step, st.label,
       (select count(*)::int from ops.institution i
         where i.archived_at is null and i.segment = seg.segment and i.stage <> 'churned' and i.stage >= st.stage) as institutions
from (values ('school'), ('college'), ('other')) as seg (segment)
cross join (values
  (1, 'contacted',          'Contacted',          'contacted'::ops.lifecycle_stage),
  (2, 'qualified',          'Qualified',          'qualified'::ops.lifecycle_stage),
  (3, 'deal_won',           'Deal won',           'deal_won'::ops.lifecycle_stage),
  (4, 'workshop_delivered', 'Workshop delivered', 'workshop_delivered'::ops.lifecycle_stage),
  (5, 'teachers_trained',   'Teachers trained',   'teachers_trained'::ops.lifecycle_stage),
  (6, 'active',             'Active',             'active'::ops.lifecycle_stage)
) as st (ord, step, label, stage);

create or replace function ops.ide_funnel() returns table (
  connected boolean, students_signed_up integer, compiled integer, flashed integer, published integer, last_synced timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.is_internal() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
  select count(*) > 0, count(*)::int, count(u.first_compile_at)::int, count(u.first_flash_at)::int,
         count(u.first_publish_at)::int, max(u.synced_at)
    from ops.ide_user_snapshot u;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.ide_funnel() to authenticated, service_role;
