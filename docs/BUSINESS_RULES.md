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
| Won (workshop/fdp/bundle) -> draft event + `trainer_request` (training) + `reserve_kits` (workshop) tasks; institution -> `deal_won`. Won `lab_setup` -> `plan_lab_setup` task | `on_deal_won` | n/a |

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

## Access
See `ACCESS_MODEL.md` (`claim_access`, last-founder protection, invite rules).

## Not yet implemented (decide with the founder, then add as new migrations + tests)
- **Event `in_progress`:** manual button vs cron at `starts_at`.
- **Stage `active`:** proposal: institution becomes `active` when >= N distinct cohort students from it
  have a flash/compile in the last 14 days (compute nightly from `ide_user_snapshot`).
- **Stage `lab_customer`:** proposal: set when a `lab_setup` (or bundle) deal is won; also create a lab
  record and a recurring support/renewal task.
- **`renewal` / `churned`:** proposal: renewal task 60 days before contract end; churned manual.
- **Deal Won requires value > 0** unless a `free` flag is set (open question: are workshops free to win labs?).
- **Soft delete / archive** for institutions, deals, events.
- **`forget_user()`** for DPDP erasure of IDE-user-linked rows.
- **KPI snapshot writer** (`ops.snapshot_kpis(date)`), partner scorecard view.
