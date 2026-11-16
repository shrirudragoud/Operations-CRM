-- 0016 deal guards (Sales workspace)
-- 1. A deal value can never be negative.
-- 2. Once a deal is Won, only the founder can change what it is worth or who it is for (D7: partner
--    KPIs and equity depend on Won deals, so a partner or member must not edit them afterwards).
-- 3. deal_line.seq keeps the order the lines were entered in (ids are random uuids).
-- 4. ops.replace_deal_lines(): the proposal lines of a deal are saved as one atomic set.

alter table ops.deal_line add column seq bigint generated always as identity;

create or replace function ops.deal_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.value_inr < 0 then
    raise exception 'A deal value cannot be negative';
  end if;
  if tg_op = 'UPDATE' and old.stage = 'won' and auth.uid() is not null and not ops.is_founder()
     and (new.value_inr is distinct from old.value_inr
          or new.kind is distinct from old.kind
          or new.institution_id is distinct from old.institution_id
          or new.owner_id is distinct from old.owner_id
          or new.title is distinct from old.title
          or new.probability is distinct from old.probability
          or new.expected_close is distinct from old.expected_close) then
    raise exception 'Only the founder can change a won deal';
  end if;
  return new;
end $$;
create trigger t_deal_3_guard before insert or update on ops.deal
  for each row execute function ops.deal_guard();

create or replace function ops.deal_line_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_stage text;
begin
  select stage into v_stage from ops.deal where id = coalesce(new.deal_id, old.deal_id);
  if v_stage = 'won' and auth.uid() is not null and not ops.is_founder() then
    raise exception 'Only the founder can change the lines of a won deal';
  end if;
  return coalesce(new, old);
end $$;
create trigger t_deal_line_guard before insert or update or delete on ops.deal_line
  for each row execute function ops.deal_line_guard();

-- Replaces every line of a deal in one transaction. Security definer because deleting lines is a
-- lead-only RLS action while replacing a draft proposal is everyday work for Sales; the access
-- check below is the same one the deal_upd policy applies (write access + Sales, or a partner's own deal).
create or replace function ops.replace_deal_lines(p_deal uuid, p_lines jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare d ops.deal%rowtype; l jsonb; n integer := 0;
begin
  select * into d from ops.deal where id = p_deal;
  if not found then raise exception 'Deal not found'; end if;
  if auth.uid() is not null and not (
       ops.can_write() and (ops.in_dept('sales') or (ops.my_role() = 'partner' and d.owner_id = auth.uid()))) then
    raise exception 'You do not have permission to change this deal' using errcode = '42501';
  end if;
  if d.stage = 'won' and auth.uid() is not null and not ops.is_founder() then
    raise exception 'Only the founder can change the lines of a won deal';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Lines must be a list';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'A deal can have at most 100 lines';
  end if;

  delete from ops.deal_line where deal_id = p_deal;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce(btrim(l->>'description'), '') = '' then raise exception 'Every line needs a description'; end if;
    if length(l->>'description') > 200 then raise exception 'A line description can be at most 200 characters'; end if;
    if coalesce((l->>'qty')::numeric, 0) <= 0 then raise exception 'Every line needs a quantity above zero'; end if;
    if coalesce((l->>'unit_price_inr')::numeric, 0) < 0 then raise exception 'A unit price cannot be negative'; end if;
    insert into ops.deal_line (deal_id, description, qty, unit_price_inr)
    values (p_deal, btrim(l->>'description'), (l->>'qty')::numeric, coalesce((l->>'unit_price_inr')::numeric, 0));
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.replace_deal_lines(uuid, jsonb) to authenticated, service_role;
