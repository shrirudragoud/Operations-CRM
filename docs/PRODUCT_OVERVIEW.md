# Product overview

## Purpose
Hard-Code sells an AI hardware IDE (plain-language intent -> circuit, firmware, build, flashing) into
schools and colleges. The company runs a physical, relationship-heavy operation: finding institutions,
selling workshops/faculty training/labs, delivering workshops with kits, training teachers, watching how
students use the IDE, growing a maker community. This app is the single system for all of it.

## The core insight: one journey, not six tools
Read the operations chart left to right: **Outreach** finds an institution, **Sales** signs it,
**Workshop** delivers with inventory, **Training** staffs and certifies, students sign up to the IDE
(**Product** sees usage in PostHog), their projects appear in **Community**, whose stories feed
Outreach. The **Institution** is the primary record; every deal, event, kit movement, trainer
assignment, cohort and feedback item links back to it.

## Departments (from the operations chart)
| Department | Functions | Owns | Main work type |
| --- | --- | --- | --- |
| Outreach | College outreach, school outreach, STEM class | Finding/qualifying institutions | Activities |
| Sales | Workshops/cohorts, faculty training, labs | Signing deals | Deal pipeline |
| Workshop | School, college, inventory | Delivering events; all physical stock | Events + run sheets; stock ledger |
| Training | School trainer, school teacher trainer | Trainer and teacher capability | Rosters, certification |
| Product | Tech/infra, DB store, tests, user analytics, feedback | The IDE and its data | Review queue, insights, incidents, catalog queue |
| Community | Projects, videos, stories, promotions, feedback | Maker community growth | Content pipeline, curation, metrics |

## Overlaps resolved (decisions, do not reopen casually)
| Overlap | Rule |
| --- | --- |
| "Workshops/Cohorts" (Sales) vs "School/College" (Workshop) | Sales **sells**, Workshop **delivers**. Won deal auto-creates the event. |
| Outreach vs Sales | Outreach ends at **Qualified**; Sales starts at **Meeting**. One owner per institution at a time. |
| Inventory vs DB Store vs Buy stock | One stock **ledger** with locations. Product owns the *catalog*; Workshop owns *stock*. |
| Feedback in Product and Community | One `feedback` table, tagged by source, routed by source to an owner department. |

## Institution lifecycle (enum `ops.lifecycle_stage`, forward-only)
prospect -> contacted -> qualified -> deal_won -> workshop_delivered -> teachers_trained -> active ->
lab_customer -> renewal | churned. Stages are moved by events (see `BUSINESS_RULES.md`), not hand-edited;
only the founder can move a stage backwards.

## Founder cockpit (the fundraising story)
Institutions reached -> qualified -> signed -> workshops delivered -> students trained -> activated (first
flash within 7 days of the event) -> projects published -> Buy orders / lab revenue. Plus pipeline value,
kit loss (INR), cloud-credit runway, partner KPI scorecards, top open product insights. Every number
drills down to records. Sources: `ops.v_cohort_activation`, `deal`, `event`, `stock_movement`,
`kpi_snapshot`.

## Distribution partners
Partners (e.g. the part-time distribution partner with KPI-linked equity) are users with role `partner`.
They see only institutions/activities/deals/events they own. Their quarterly targets are rows in
`kpi_target`, measured from real deals and events (scorecard is generated, not self-reported).

## Out of scope (v1)
Accounting/invoicing (store invoice links only), payroll, public customer portal, rebuilding session
replay (link to PostHog), student PII beyond IDE user id + email + cohort code.
