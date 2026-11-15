# Data model (schema `ops`)

35 tables, 5 views, enums `department`, `app_role`, `lifecycle_stage`. Source of truth:
`supabase/migrations/`. Keys are `uuid` (`gen_random_uuid()`), money `numeric(12,2)` INR, times `timestamptz`.

## Tables by group
| Group (migration) | Tables | Owner dept |
| --- | --- | --- |
| Core (0001) | `staff` (1:1 `auth.users`), `institution`, `contact`, `task`, `feedback`, `audit_log`, `kpi_target`, `kpi_snapshot` | shared |
| Access (0009) | `invite` | founder |
| Outreach (0002) | `activity` | Outreach |
| Sales (0002) | `deal`, `deal_line` | Sales |
| Workshop (0003) | `event`, `event_staff`, `cohort`, `run_sheet_template`, `run_sheet_item` | Workshop |
| Inventory (0003) | `item`, `kit`, `kit_component`, `location`, `stock_movement`, `stock_reservation` | Workshop |
| Training (0004) | `trainer_profile`, `training_program`, `enrollment` | Training |
| Product (0005) | `ide_user_snapshot`, `ph_user_daily`, `ph_session`, `insight`, `review_item`, `observation`, `incident`, `catalog_request` | Product |
| Community (0006) | `content_item` | Community |

## Views (all `security_invoker`)
`v_stock` (on_hand, in_warehouse, reserved, available per item), `v_stock_by_location`,
`v_low_stock`, `v_certified_trainer`, `v_cohort_activation` (per cohort: signed_up, compiled_7d,
flashed_7d, published).

## Key relationships
```
institution 1-* contact, activity, deal, event, enrollment(teachers), content_item, feedback
deal 1-* deal_line ; deal 1-0..1 event (created when Won)
event 1-1 cohort ; event 1-* run_sheet_item, event_staff, stock_reservation, stock_movement
kit *-* item (kit_component) ; item 1-* stock_movement ; location 1-* stock_movement
staff 1-0..1 trainer_profile ; staff/contact 1-* enrollment -> training_program
cohort.code <- ide_user_snapshot.cohort_code (joins workshop to product usage)
ph_session 1-1 review_item 1-* observation *-1 insight ; feedback *-1 insight
```

## Polymorphic links
`task.entity_type/entity_id` ('institution' | 'deal' | 'event' | 'item') links a task to any record; no FK.
Use it for "related record" chips in the UI. `audit_log.table_name/row_id` likewise.

## Conventions
- `updated_at` maintained by `ops.touch_updated_at()` where present.
- Audit triggers (`ops.audit()`) on institution, deal, event, stock_movement, kpi_target, staff, invite.
- Enums as `text + check` for rarely-changing business vocab (stages, kinds); Postgres enums only for
  department, role, lifecycle stage. Adding a stage/kind = new migration altering the check.
- Indexes exist on the hot paths (task assignee/status/due, activity by institution, deal stage, event by
  trainer/start, stock by item+location, review queue). Re-check with `EXPLAIN` once real volume exists.
- Everything has RLS; see `ACCESS_MODEL.md`.

## Functions (callable surface)
Read helpers: `my_role()`, `is_founder()`, `in_dept(d)`, `can_write()`, `me()`.
User RPCs (authenticated): `claim_access()`, `me()`, `invite_staff(email, role, departments, name)`,
`revoke_invite(id)`, `update_staff_access(staff, role, departments, is_active)` (founder only, 0010), `reserve_kit(event, kit, qty)`, `issue_kit(event, kit, qty,
from, to)`, `close_event_returns(event, field_loc, back_loc, returns jsonb, note)`.
Service jobs (service_role only): `assign_review_queue(day, quota)`, `raise_low_stock_tasks()`,
`request_part(query, source)`.
Triggers hold the rest (see `BUSINESS_RULES.md`).

`close_event_returns` payload: `[{"item_id": "...", "returned": n, "damaged": n, "lost": n}, ...]`.

## Adding to the model
New migration file; RLS + policies + grants in the same file; tests in `tools/test-migrations.mjs`;
update this doc and `BUSINESS_RULES.md`; regenerate `all_migrations.sql` and the TypeScript types.
