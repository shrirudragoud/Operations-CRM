-- Details for notification emails. The queue only holds a one-line message; the sender asks for the task, meeting or HR request
-- behind each queued row so the mail can show due date, priority, time, place, who is invited and so on.
-- Service role only (the sender script). It returns facts the recipient could already open in the app; nothing is written.
create or replace function ops.email_details(p_ids bigint[])
returns table (id bigint, details jsonb)
language sql stable security definer set search_path = '' as $$
  select o.id,
    case
      when n.task_id is not null then (
        select jsonb_build_object(
          'type', 'task', 'title', t.title, 'status', t.status, 'priority', t.priority, 'due_date', t.due_date,
          'due_time', t.due_time, 'department', t.department::text, 'category', t.category,
          'assignee', a.full_name, 'assigned_by', ab.full_name, 'by', act.full_name,
          'description', left(t.description, 280))
          from ops.task t
          left join ops.staff a on a.id = t.assignee_id
          left join ops.staff ab on ab.id = t.assigned_by
         where t.id = n.task_id)
      when n.meeting_id is not null then (
        select jsonb_build_object(
          'type', 'meeting', 'meeting_id', m.id, 'title', m.title, 'status', m.status, 'kind', m.kind,
          'starts_at', m.starts_at, 'ends_at', m.ends_at, 'updated_at', m.updated_at, 'location', m.location,
          'department', m.department::text, 'description', left(m.description, 280), 'cancel_reason', m.cancel_reason,
          'organizer', og.full_name, 'organizer_email', og.email, 'by', act.full_name,
          'attendees', coalesce((
            select jsonb_agg(s.full_name order by s.full_name)
              from (select s2.full_name from ops.meeting_attendee ma join ops.staff s2 on s2.id = ma.staff_id
                     where ma.meeting_id = m.id order by s2.full_name limit 12) s), '[]'::jsonb),
          'attendee_count', (select count(*) from ops.meeting_attendee ma where ma.meeting_id = m.id))
          from ops.meeting m
          left join ops.staff og on og.id = m.organizer_id
         where m.id = n.meeting_id)
      when n.request_id is not null then (
        select jsonb_build_object(
          'type', 'request', 'kind', r.kind, 'subject', left(r.subject, 200), 'state', r.state,
          'from', rs.full_name, 'by', act.full_name)
          from ops.hr_request r
          left join ops.staff rs on rs.id = r.staff_id
         where r.id = n.request_id)
      else null
    end as details
  from ops.email_outbox o
  left join ops.notification n on n.id = o.notification_id
  left join ops.staff act on act.id = n.actor_id
  where o.id = any (p_ids)
$$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.email_details(bigint[]) to service_role;
