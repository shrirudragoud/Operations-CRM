# Business rules

All rules below are enforced in Postgres (`supabase/migrations/0007_business_logic.sql` unless noted) and
covered by `tools/test-migrations.mjs`. The UI must surface the raised error message to the user.
`auth.uid() is null` (service role / SQL editor / migrations) bypasses user-level guards by design.

## Institution
| Rule | Enforced by | Error |
| --- | --- | --- |
| Stage only moves forward; founder can correct; `churned` always allowed | trigger `t_institution_stage` | "Institution stage cannot move backwards" |
| Qualified activity -> stage `qualified` + a Sales deal at *meeting* if no open deal | `on_activity` | n/a |
| Interested / not_interested / follow_up outcome on a prospect -> `contacted` | `on_activity` | n/a |
| Activity with next step + due date -> follow-up task for the author | `on_activity` | n/a |

## Deals
| Rule | Enforced by | Error |
| --- | --- | --- |
| New deals start at *meeting* (founder/service excepted) | `deal_insert_guard` | "New deals must start at the Meeting stage" |
| Allowed moves: meeting->proposal/lost; proposal->meeting/negotiation/lost; negotiation->proposal/won/lost; lost->meeting | `deal_transition` | "Deal cannot move from X to Y" |
| Won is final | `deal_transition` | "A won deal cannot change stage" |
| Only the founder can mark Won; `won_at` stamped | `deal_transition` | "Only the founder can mark a deal as won" |
| Lost needs a reason; leaving lost clears it | `deal_transition` + check | "A lost reason is required" |
| Deal types: `workshop`, `fdp` (Faculty training), `lab_setup` (Lab deal), `other` | check `deal_kind_check` | check violation |
| One open deal per type per institution; different types may run in parallel | unique index `deal_one_open_per_kind` | duplicate key value violates `deal_one_open_per_kind` |
| Won workshop/fdp -> draft event + `trainer_request` (training) + `reserve_kits` (workshop) tasks; institution -> `deal_won`. Won `lab_setup` -> `plan_lab_setup` task. Won `other` -> `plan_other_deal` Sales task only | `on_deal_won` | n/a |
| `institution.segment` (school / college / other) is derived from `kind`; `v_funnel` and `v_pipeline` report by segment and deal type | generated column + views | n/a |
| A deal value cannot be negative | `deal_guard` (0016) | "A deal value cannot be negative" |
| Once Won, only the founder can change a deal's value, type, institution, owner, title, chance or close date | `deal_guard` (0016) | "Only the founder can change a won deal" |
| Only the founder can change the proposal lines of a Won deal | `deal_line_guard`, `replace_deal_lines` (0016) | "Only the founder can change the lines of a won deal" |
| Proposal lines are replaced as one atomic set (max 100, description, quantity above zero, price not negative); Sales or the owning partner only | `replace_deal_lines` (security definer, same access check as `deal_upd`) | "You do not have permission to change this deal" / line errors |
| Community memberships (club / ambassador / other): readable by internal staff, written by Community, deleted by Community lead/founder; unique per institution + kind + name | RLS `community_membership_*` | permission error |

## Events
| Rule | Enforced by | Error |
| --- | --- | --- |
| New events start as draft | `event_guard` | "New events must start as draft" |
| Moves: draft->scheduled/cancelled; scheduled->draft/in_progress/completed/cancelled; in_progress->completed/cancelled | `event_guard` | "Event cannot move from X to Y" |
| Scheduling needs lead trainer, start, end, venue, expected headcount | `event_guard` | "To schedule an event set: ..." |
| Lead trainer must be certified (enrollment certified in an `internal_trainer` program) or founder role | `event_guard` | "Lead trainer is not certified" |
| No trainer double-booking (lead or assistant) across scheduled/in-progress events | `trainer_conflict`, `event_guard`, `event_staff_guard` | "already booked" |
| Scheduled -> cohort code `HC-XXXX` (unambiguous alphabet) + run sheet copied from template | `on_event_status` | n/a |
| Completing needs actual headcount and all pre/day run-sheet items done | `event_guard` | "Enter actual headcount..." / "Finish all pre-event and event-day run sheet items first" |
| Completed -> tasks: send_survey (+1d), close_returns (+2d), collect_photos (+3d, community), college_report (+5d); institution -> `workshop_delivered` | `on_event_status` | n/a |
| Cancelled -> reservations released | `on_event_status` | n/a |

## Inventory (stock is a ledger)
| Rule | Enforced by | Error |
| --- | --- | --- |
| Balance per item+location can never go negative (advisory-locked, race-safe) | `guard_stock` | "Insufficient stock..." |
| received > 0; sold/damaged/lost < 0; damaged/lost/adjustment need a note | check constraints | check violation |
| `reserve_kit`: only draft/scheduled events; cannot exceed *available* (warehouse+store stock minus reserved) | RPC | "Not enough SKU available..." |
| `issue_kit`: only scheduled/in-progress events; paired movements (-from, +to); reservations -> fulfilled | RPC | "Kits can only be issued..." |
| `close_event_returns`: needs a line for every issued item; returned+damaged+lost = issued; note required for loss/damage; once only; raises `review_kit_loss` task | RPC | "must equal issued" / "note is required" / "already closed" |
| `v_stock`: `on_hand` (everywhere), `in_warehouse`, `reserved`, `available = in_warehouse - reserved` | view | n/a |
| `raise_low_stock_tasks()` (service job): one open `low_stock` task per item where available < reorder level | function | n/a |

## Training
| Rule | Enforced by |
| --- | --- |
| Certified enrollment needs `certified_at` | check constraint |
| Last enrolled teacher at an institution certified -> institution `teachers_trained` | `on_enrollment` |

## Product
| Rule | Enforced by |
| --- | --- |
| Observation insert marks its review item reviewed | `on_observation` |
| Skipping a review item needs a reason | check constraint |
| `assign_review_queue(day, quota)` round-robins highest-signal sessions (rage clicks, errors) across active product reviewers | function (service job) |
| `request_part(query, source)` dedupes by normalised query and counts requests | function (service job) |
| Feedback with no owner department is routed by source | `route_feedback` |

## Archive (0011)
| Rule | Enforced by | Error |
| --- | --- | --- |
| Institutions, deals and events are archived (`archived_at`, `archived_by`), not deleted; restore clears them | columns + `guard_archive` | n/a |
| Only founder or dept_lead can archive/restore (partners and members cannot) | `guard_archive` | "Only a founder or department lead can archive or restore records" |
| Institution: no open deals, no scheduled/in-progress events | `guard_archive` | "Close or archive the institution's open deals first" / "Cancel or complete ..." |
| Deal must be won or lost; event must not be scheduled/in progress | `guard_archive` | "Mark the deal won or lost ..." / "Cancel or complete the event ..." |
Screens hide archived rows by default (`archived_at is null`). 0012: `trainer_conflict` is no longer callable by users.

## Core completion (0013)
| Rule | Enforced by | Error |
| --- | --- | --- |
| `available_trainers(from, to, exclude_event)` lists certified (or founder) active staff with `is_free`; Workshop (and founder) only; `exclude_event` stops a re-scheduled event blocking itself | definer RPC | "Only Workshop can look up trainer availability" / "Choose a valid start and end" |
| `import_institutions(rows, dry_run)`: validates every row (name, kind, case-insensitive duplicates in file and database, owner email); any error or dry run writes nothing; max 2000 rows; partners' rows are always owned by themselves; viewers and non-Outreach/Sales cannot import | invoker RPC (RLS applies) | "row N: Already exists" etc. in the returned `errors` list; "You do not have permission to import institutions" |
| `job_run`: founder-readable log; only the service role writes | RLS | n/a |
| `forget_ide_user(ide_user_id, email)`: deletes the IDE snapshot and daily usage, anonymises replay rows, unlinks feedback; founder/service only; audit entry holds counts only | definer RPC | "Only the founder can erase a user's data" |
| Trigram indexes on institution name and city for fast search (`ilike '%x%'`) | indexes | n/a |

## Access and team admin (0009, 0010)
| Rule | Enforced by | Error |
| --- | --- | --- |
| Sign-in grants nothing; an open, unexpired invite for the verified email becomes a staff row on first `claim_access()` | `claim_access` | n/a (returns `no_invite`) |
| Last active founder cannot be demoted, deactivated or deleted | `guard_last_founder` | "There must be at least one active founder" |
| Only the founder invites, revokes, or changes role/departments/active | `invite_staff`, `revoke_invite`, `update_staff_access` + RLS | "Only the founder can ..." |
| Partners have no departments; dept_lead/member/viewer need at least one | check constraints + `check_access_shape` | "Partners cannot belong to departments..." / "Choose at least one department..." |
| Cannot invite someone already on the team (deactivated -> reactivate instead) | `invite_staff` | "... is already on the team" / "... reactivate them ..." |
| Re-inviting an open invite refreshes role, departments and the 30-day expiry (one open invite per email) | `invite_staff` + unique index | n/a |
| Accepted invites cannot be revoked | `revoke_invite` | "Invite not found or already accepted" |
| A partner may open deals only at institutions they own | RLS `deal_ins` / `deal_upd` | permission error |
See `ACCESS_MODEL.md` for the full matrix.

## Not yet implemented (decide with the founder, then add as new migrations + tests)
- **Event `in_progress`:** manual button vs cron at `starts_at`.
- **Stage `active`:** proposal: institution becomes `active` when >= N distinct cohort students from it
  have a flash/compile in the last 14 days (compute nightly from `ide_user_snapshot`).
- **Stage `lab_customer`:** proposal: set when a `lab_setup` deal is won; also create a lab
  record and a recurring support/renewal task.
- **`renewal` / `churned`:** proposal: renewal task 60 days before contract end; churned manual.
- **Deal Won requires value > 0** unless a `free` flag is set (open question: are workshops free to win labs?).
- **Soft delete / archive** for institutions, deals, events.
- **`forget_user()`** for DPDP erasure of IDE-user-linked rows.
- **KPI snapshot writer** (`ops.snapshot_kpis(date)`), partner scorecard view.
