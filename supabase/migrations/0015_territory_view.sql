-- 0015: territory view for the Outreach workspace.
-- One row per live institution with its last touch, so Outreach can list "untouched" or "gone cold"
-- institutions by district/segment with server-side filters and pagination. security_invoker: each
-- viewer only sees institutions and activities their own RLS allows (a partner: only their own).
create view ops.v_territory with (security_invoker = true) as
select i.id, i.name, i.kind, i.segment, i.city, i.district, i.state, i.stage, i.owner_id,
       a.last_activity_at, a.activities
from ops.institution i
left join lateral (
  select max(x.happened_at) as last_activity_at, count(*)::int as activities
  from ops.activity x
  where x.institution_id = i.id
) a on true
where i.archived_at is null;

revoke execute on all functions in schema ops from public;
