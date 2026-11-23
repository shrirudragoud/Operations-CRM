-- 0042: the task assistant (bring-your-own Gemini key).
--  * ops.ai_key: one row per person holding their Gemini key, ALREADY ENCRYPTED by the app (AES-256-GCM, bound to the
--    person's id). The ciphertext is never selectable by a signed-in user (column grants) and is only handed back to its
--    owner through ops.load_ai_key(). The database never sees the plain key.
--  * ops.ai_conversation / ops.ai_message: a person's chats, private to them.
--  * ops.ai_action: a DRAFT the assistant proposes (create a task, change a status, ...). Nothing happens until the
--    person confirms it; the app then runs it through the normal task actions with that person's own session, so every
--    task rule and every RLS policy still applies. A draft cannot be edited after it is made, expires after 24 hours,
--    and can only move pending -> running -> done / failed (failed -> running to retry), or pending -> cancelled.
-- Limits that keep one account from running away live here too: chats, messages per hour and day, drafts waiting.

-- ---------------------------------------------------------------- the key
create table ops.ai_key (
  staff_id   uuid primary key references ops.staff (id) on delete cascade,
  cipher     text not null check (char_length(cipher) between 20 and 2000),
  key_hint   text not null check (char_length(key_hint) between 1 and 8),
  model      text not null check (model ~ '^[A-Za-z0-9._-]{1,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table ops.ai_key enable row level security;
create policy ai_key_sel on ops.ai_key for select to authenticated
  using (staff_id = (select auth.uid()));
-- No insert/update/delete policy: written only through the functions below.
revoke all on ops.ai_key from authenticated, anon;
grant select (staff_id, key_hint, model, created_at, updated_at) on ops.ai_key to authenticated;

create or replace function ops.ai_caller() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or ops.is_system() then raise exception 'Sign in to use the assistant' using errcode = '42501'; end if;
  if not exists (select 1 from ops.staff where id = uid and is_active) then
    raise exception 'Your access was removed' using errcode = '42501';
  end if;
  return uid;
end $$;

create or replace function ops.save_ai_key(p_cipher text, p_hint text, p_model text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := ops.ai_caller();
begin
  insert into ops.ai_key (staff_id, cipher, key_hint, model) values (uid, p_cipher, p_hint, p_model)
  on conflict (staff_id) do update set cipher = excluded.cipher, key_hint = excluded.key_hint, model = excluded.model, updated_at = now();
end $$;

create or replace function ops.set_ai_model(p_model text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := ops.ai_caller();
begin
  if p_model is null or p_model !~ '^[A-Za-z0-9._-]{1,80}$' then raise exception 'Choose a model'; end if;
  update ops.ai_key set model = p_model, updated_at = now() where staff_id = uid;
  if not found then raise exception 'Add your Gemini key first'; end if;
end $$;

create or replace function ops.delete_ai_key() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := ops.ai_caller();
begin
  delete from ops.ai_key where staff_id = uid;
end $$;

create or replace function ops.load_ai_key() returns table (cipher text, model text)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := ops.ai_caller();
begin
  return query select k.cipher, k.model from ops.ai_key k where k.staff_id = uid;
end $$;

-- ---------------------------------------------------------------- chats
create table ops.ai_conversation (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null default auth.uid() references ops.staff (id) on delete cascade,
  title      text not null default 'New chat' check (char_length(btrim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversation_staff_idx on ops.ai_conversation (staff_id, updated_at desc);
alter table ops.ai_conversation enable row level security;
create policy ai_conversation_sel on ops.ai_conversation for select to authenticated using (staff_id = (select auth.uid()));
create policy ai_conversation_ins on ops.ai_conversation for insert to authenticated with check (staff_id = (select auth.uid()));
create policy ai_conversation_upd on ops.ai_conversation for update to authenticated
  using (staff_id = (select auth.uid())) with check (staff_id = (select auth.uid()));
create policy ai_conversation_del on ops.ai_conversation for delete to authenticated using (staff_id = (select auth.uid()));

create or replace function ops.ai_conversation_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform ops.ai_caller();
    if (select count(*) from ops.ai_conversation where staff_id = new.staff_id) >= 200 then
      raise exception 'You have 200 chats. Delete some before starting another';
    end if;
  else
    if new.staff_id <> old.staff_id then raise exception 'A chat cannot change owner'; end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger t_ai_conversation_guard before insert or update on ops.ai_conversation
  for each row execute function ops.ai_conversation_guard();

create table ops.ai_message (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,
  conversation_id uuid not null references ops.ai_conversation (id) on delete cascade,
  staff_id        uuid not null default auth.uid() references ops.staff (id) on delete cascade,
  role            text not null check (role in ('user', 'model', 'tool')),
  content         jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 100000),
  created_at      timestamptz not null default now()
);
create index ai_message_conversation_idx on ops.ai_message (conversation_id, seq);
create index ai_message_staff_idx on ops.ai_message (staff_id, created_at);
alter table ops.ai_message enable row level security;
create policy ai_message_sel on ops.ai_message for select to authenticated using (staff_id = (select auth.uid()));
create policy ai_message_ins on ops.ai_message for insert to authenticated with check (staff_id = (select auth.uid()));
create policy ai_message_del on ops.ai_message for delete to authenticated using (staff_id = (select auth.uid()));
-- Messages are never edited.

create or replace function ops.ai_message_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform ops.ai_caller();
  if not exists (select 1 from ops.ai_conversation c where c.id = new.conversation_id and c.staff_id = new.staff_id) then
    raise exception 'That chat was not found';
  end if;
  if (select count(*) from ops.ai_message where conversation_id = new.conversation_id) >= 600 then
    raise exception 'This chat is full. Start a new one';
  end if;
  if new.role = 'user' then
    if (select count(*) from ops.ai_message where staff_id = new.staff_id and role = 'user' and created_at > now() - interval '1 hour') >= 60 then
      raise exception 'You have sent a lot of messages this hour. Wait a few minutes and try again';
    end if;
    if (select count(*) from ops.ai_message where staff_id = new.staff_id and role = 'user' and created_at > now() - interval '1 day') >= 400 then
      raise exception 'You have reached today''s limit of 400 messages. Try again tomorrow';
    end if;
  end if;
  return new;
end $$;
create trigger t_ai_message_guard before insert on ops.ai_message
  for each row execute function ops.ai_message_guard();

create or replace function ops.ai_message_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update ops.ai_conversation set updated_at = now() where id = new.conversation_id;
  return null;
end $$;
create trigger t_ai_message_touch after insert on ops.ai_message
  for each row execute function ops.ai_message_touch();

-- ---------------------------------------------------------------- drafts
create table ops.ai_action (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ops.ai_conversation (id) on delete cascade,
  staff_id        uuid not null default auth.uid() references ops.staff (id) on delete cascade,
  kind            text not null check (kind in ('create_task', 'create_subtasks', 'update_task', 'set_schedule', 'change_status', 'assign_task', 'add_comment')),
  payload         jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 30000),
  summary         text not null check (char_length(btrim(summary)) between 1 and 600),
  status          text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  result          jsonb,
  error           text check (char_length(error) <= 600),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  expires_at      timestamptz not null default now() + interval '24 hours'
);
create index ai_action_conversation_idx on ops.ai_action (conversation_id, created_at);
create index ai_action_staff_idx on ops.ai_action (staff_id, status);
alter table ops.ai_action enable row level security;
create policy ai_action_sel on ops.ai_action for select to authenticated using (staff_id = (select auth.uid()));
create policy ai_action_ins on ops.ai_action for insert to authenticated with check (staff_id = (select auth.uid()));
create policy ai_action_upd on ops.ai_action for update to authenticated
  using (staff_id = (select auth.uid())) with check (staff_id = (select auth.uid()));
create policy ai_action_del on ops.ai_action for delete to authenticated using (staff_id = (select auth.uid()));

create or replace function ops.ai_action_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform ops.ai_caller();
  if tg_op = 'INSERT' then
    if not exists (select 1 from ops.ai_conversation c where c.id = new.conversation_id and c.staff_id = new.staff_id) then
      raise exception 'That chat was not found';
    end if;
    if (select count(*) from ops.ai_action where staff_id = new.staff_id and status = 'pending') >= 30 then
      raise exception 'You have 30 drafts waiting. Confirm or discard some first';
    end if;
    new.status := 'pending'; new.result := null; new.error := null; new.decided_at := null;
    new.created_at := now(); new.expires_at := now() + interval '24 hours';
    return new;
  end if;

  if new.kind is distinct from old.kind or new.payload is distinct from old.payload or new.summary is distinct from old.summary
     or new.staff_id is distinct from old.staff_id or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at then
    raise exception 'A draft cannot be changed. Ask for a new one';
  end if;
  if new.status = old.status and new.status = 'running' and old.decided_at < now() - interval '5 minutes' then
    new.decided_at := now();
    return new;
  end if;
  if new.status is not distinct from old.status then
    if new.result is distinct from old.result or new.error is distinct from old.error or new.decided_at is distinct from old.decided_at then
      raise exception 'A draft''s outcome is set when it moves on';
    end if;
    return new;
  end if;
  if not ((old.status = 'pending' and new.status in ('running', 'cancelled'))
       or (old.status = 'running' and new.status in ('done', 'failed'))
       or (old.status = 'failed' and new.status = 'running')) then
    raise exception 'This draft is already % and cannot be %', old.status, new.status;
  end if;
  if new.status = 'running' and old.expires_at < now() then
    raise exception 'This draft has expired. Ask the assistant again';
  end if;
  new.decided_at := now();
  if new.status = 'running' then new.error := null; end if;
  return new;
end $$;
create trigger t_ai_action_guard before insert or update on ops.ai_action
  for each row execute function ops.ai_action_guard();

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema ops from public;
grant execute on function ops.save_ai_key(text, text, text), ops.set_ai_model(text), ops.delete_ai_key(), ops.load_ai_key() to authenticated;
