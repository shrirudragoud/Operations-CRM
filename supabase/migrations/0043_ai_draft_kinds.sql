-- 0043: the assistant learns calendar, workshop and sales drafts. Only the list of draft kinds changes; the table,
-- its RLS policies and the guard trigger (0042) already cover every kind the same way, so a new kind needs no new rule.
-- A draft still only runs when its owner confirms it, through the same server action the screens use.

alter table ops.ai_action drop constraint ai_action_kind_check;
alter table ops.ai_action add constraint ai_action_kind_check check (kind in (
  'create_task', 'create_subtasks', 'update_task', 'set_schedule', 'change_status', 'assign_task', 'add_comment',
  'schedule_meeting', 'update_meeting', 'cancel_meeting', 'rsvp_meeting',
  'create_event', 'update_event', 'set_event_team', 'event_status', 'toggle_run_item',
  'log_activity', 'create_deal', 'update_deal', 'move_deal'
));

revoke execute on all functions in schema ops from public;
grant execute on function ops.save_ai_key(text, text, text), ops.set_ai_model(text), ops.delete_ai_key(), ops.load_ai_key() to authenticated;
