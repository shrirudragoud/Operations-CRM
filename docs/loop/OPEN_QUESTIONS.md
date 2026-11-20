# Open questions: product evolution loop

21 Nov 2026 · Owner: Shri (founder)

> **Rule for every agent:** before writing any code, migration or UI for an item below, **ask the founder
> (Shri) and wait for an answer.** Do not pick a default yourself. When answered, record the answer in
> `docs/DECISIONS.md` (next D-number, with the reason), tick the box here, and only then build.
> If a question blocks your task, stop and ask; work on something unblocked meanwhile.

Context: `docs/loop/STRATEGY.md` (why) and `docs/loop/IMPLEMENTATION_PLAN.md` (what).

## Blocks Phase B (sessions and class sign-in)

- [ ] **Q2. Programme shape.** Is a school lab one long `event` with weekly sessions, or does each term become a
      new programme? Do STEM classes follow the same shape?
- [ ] **Q5. Session sign-in in the IDE.** Confirm: trainer opens session in Ops, a short session code, teams tap
      names from the class list. Code format, expiry, and what happens if a team changes machines mid-class?
- [ ] **Q6. Class list fields.** Roll number + first name only? Who enters them (office or trainer) and how
      (CSV, manual)? Guardian consent: handled by the IDE's existing consent rules, or recorded in Ops?
- [ ] **Q7. Challenge library.** Where do challenge names and versions come from (the PDF/book)? Who can add a
      new version? Is a version bump required for any change, or only for "major" ones?
- [ ] **Q8. Product version tag.** What identifies a product version (git SHA, semver, release name)?

## Blocks Phase C (raise items, close in the field)

- [ ] **Q1. School teachers.** Do teachers we train get a limited Ops login to raise items, or report through
      our trainer? If a login: a new role, or `viewer` plus permission to create feedback?
- [ ] **Q3. Who decides.** Who besides the founder can set an item's fix type (product / challenge / delivery)
      and close it after the field check?
- [ ] **Q4. Field check rule.** How many sessions must pass before a field check counts (e.g. the next two
      sessions using that challenge)? Who marks pass/fail, or is it computed?
- [ ] **Q9. Issue tracker.** GitHub Issues or Linear for product items (also open as question 6 in `DECISIONS.md`).
- [ ] **Q10. Raise-item categories.** Confirm the list: bug, feature request, issue, review. Anything else?

## Blocks Phase D (automatic signals)

- [ ] **Q11. Stuck thresholds.** What counts as "stuck": how many repeated compile failures, how many minutes idle
      on one step?
- [ ] **Q12. AI prompts.** Store full prompt text in Ops, or a link/ID into the IDE's own store? Retention period
      for minors' prompts?
- [ ] **Q13. Raise hand on the trainer's phone.** Live push (needs realtime) or a refreshing queue page?

## Strategy-level (no build blocked yet)

- [ ] **Q14.** Who decides items day to day once volume grows beyond the founder?
- [ ] **Q15.** When a school gets its own devices, do we move from team sign-in to one login per kid?
- [ ] **Q16.** How do we keep college students' and faculty's contact after a workshop: a community space, the
      IDE itself, or both?
