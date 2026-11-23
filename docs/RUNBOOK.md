# Runbook

Short procedures for when something goes wrong. The hosted project is `<your-project-ref>`; the app is the
Docker container `hardcode-ops-app` behind the Cloudflare tunnel. Never touch `<other-project-ref>` (the IDE product DB).

## Is it up?
- `GET https://ops.hard-code.in/api/health`: 200 `{"status":"ok","db":true}` is healthy; 503 means the app is up but cannot reach the database (it asks Postgres for an ops table as anon and expects the 42501 refusal).
- Point an uptime monitor at it (the founder picks the tool; any 1-minute HTTP check that alerts on non-200 works).
- App errors: `docker logs hardcode-ops-app` shows one JSON line per unhandled server error (`level":"error"`, with `path` and `digest`).

## Backups and restore drill
Backups are Supabase's. Free plan: daily backups are not downloadable and there is no point-in-time restore, so
**before real data matters, upgrade to a plan with PITR** (Dashboard, Database, Backups).

Until then, take your own copy weekly from a machine that can reach Postgres:

    pg_dump "$HOSTED_DB_URL" --schema=ops --format=custom --file=ops-$(date +%F).dump

Keep the last four copies somewhere other than the server. The connection string comes from the Dashboard; do not commit it.

Restore drill (do it once now, then every quarter), always on a **local** database, never on hosted:

1. `npx supabase start` (local stack).
2. `pg_restore --clean --if-exists --no-owner -d "postgresql://postgres:postgres@127.0.0.1:54322/postgres" ops-YYYY-MM-DD.dump`
3. Check: `select count(*) from ops.institution;` matches what the app shows, and `select max(started_at) from ops.job_run;` is recent.
4. Write the date and result at the bottom of this file.

To restore into hosted after a real loss: use the Dashboard (PITR, or the latest backup) rather than `pg_restore`; then run the migration check below.

## A job is overdue or failing
1. As the founder: `select * from ops.job_health();` (SQL editor or the app once the Cockpit shows it).
2. `select job, status, started_at, error from ops.job_run order by started_at desc limit 20;` shows the error.
3. Run it by hand with the service role: `select ops.run_job('kpi_snapshot');`. A `skipped` result means it is already running.
4. If every job is overdue, pg_cron is not running or the schedules are missing: `select jobname, schedule, active from cron.job;`
   and `select * from cron.job_run_details order by start_time desc limit 10;`. Re-apply `supabase/schedules.sql` if empty.

## A migration failed or went wrong
- Never edit an applied migration. Fix forward with a new `00NN_name.sql`.
- Apply: `npx supabase db query --remote --yes -f supabase/migrations/00NN_name.sql`. Each file is one transaction-sized unit; if it
  stopped half way, inspect what exists before re-running (most files use `create or replace` / `if not exists`).
- After applying: `npx supabase db advisors --level info --linked` and compare with the accepted warnings in `docs/HANDOFF.md`.

## A bad deploy
- Roll back by rebuilding the previous commit: `git checkout <good-sha> && docker compose --env-file .env.local up -d --build app`.
- The database is not rolled back by a deploy; a schema change that the old code cannot read needs a forward-fix migration.

## Nobody can sign in as founder
In the SQL editor (service role): `update ops.staff set role = 'founder', is_active = true where email = '<email>';`
The person must already have signed in once so a staff row exists.

## Stock does not match the shelf
Stock is a ledger. Never edit counts. Count the shelf, then record the difference as an `adjustment` movement
with a note (Inventory, the item, Adjust). `ops.v_stock` is then correct again.

## Task files: clean-up and virus scanning
**Clean-up** (`scripts/purge-task-files.mjs`, migration 0041). Removing a file only hides it for 30 days (Undo works until then).
The job makes removals final, deletes their objects from the `task-files` bucket, and deletes objects that were uploaded but never
registered (older than 24 h, so an upload in flight is never touched). Before every delete it asks the database
(`ops.task_files_deletable`) and keeps anything a file row still points at.
- Try it without changing anything: `SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/purge-task-files.mjs --dry-run`
  (prints `would-delete` lines and a summary). Flags: `--days 30`, `--stray-hours 24`, `--max 1000` (work per run).
- Output is one JSON line per action plus a `summary`; exit code 1 if a Storage delete batch failed (the next run retries it).
- Schedule: `deploy/purge-task-files.service` and `.timer` are systemd user-unit examples (nightly 02:30). Install by copying to
  `~/.config/systemd/user/`, put the two variables in `~/.config/hardcode-ops/purge.env` (chmod 600), then
  `systemctl --user enable --now purge-task-files.timer`. The secret key lives only in that file.
- Is it working? `systemctl --user list-timers purge-task-files.timer`, `journalctl --user -u purge-task-files -n 50`. The founder can
  also see waiting paths: `select count(*) from ops.task_file_orphan;` (it should drop to 0 after a run).

**Virus scanning** (`lib/clamav.ts`). Off unless `TASK_FILE_SCAN=required` is set for the app. When on, every upload is streamed to
ClamAV before it is registered; a flagged file is deleted and refused, and if the scanner cannot be reached the upload fails with a
"try again" message (fail closed) and the object is removed.
- Start the scanner: `docker compose -p operations-crm --env-file .env.local --profile scan up -d clamav`. The first start downloads
  signatures (a few minutes); `docker inspect -f '{{.State.Health.Status}}' hardcode-ops-clamav` says `healthy` when ready.
- Then set `TASK_FILE_SCAN=required` in `.env.local` and redeploy the app (`up -d app`). Do it in that order, or uploads will fail.
- Switch off in an emergency: unset `TASK_FILE_SCAN` and `up -d app`. Uploads still pass the type, size and magic-byte checks.
- Test it: upload the EICAR test string saved as `eicar.txt` (a harmless standard test file); it should be refused.

## The assistant (Gemini, bring your own key)
- Needs `AI_KEY_SECRET` in `.env.local` on the app host (generate: `openssl rand -base64 32`; never paste it in chat or commit it). Unset = the assistant says it is not switched on. `docker-compose.yml` passes it to the app; redeploy with `up -d app` after setting it.
- Back the secret up with the other host secrets. If it is lost or changed, every saved key becomes unreadable: people see "Your saved Gemini key could not be read. Add it again." and just paste their key again. Nothing else is affected.
- Keys are never logged and never leave the server except in the `x-goog-api-key` header to Google. A person removes their key under Assistant > Gemini key and model. Deactivating a person removes their access; delete their key row if you want it gone: `delete from ops.ai_key where staff_id = '...'`.
- A person gets "quota" or "rate" errors from their own Google account; nothing to fix here. Chat problems: `select status, count(*) from ops.ai_action group by 1` shows draft states; stuck `running` rows clear themselves after 5 minutes.
- Free Google keys allow about 20 requests per day per model, and one chat message costs 2 to 3 requests (about 7 messages a day). People then see "run out of quota"; switching model in the assistant settings gives a fresh allowance. Prefer a key on a paid plan for real use. Default model is the first available of `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-2.5-flash` (`PREFERRED_MODELS` in `lib/ai/gemini.ts`), picked when the key is saved; a saved key keeps its model until the person picks another in the settings. Gemini 3+ models are sent `thinkingLevel: low` (the default level made `gemini-3.5-flash` hang over a minute); 2.x models do not accept it. `gemini-3.8-flash` returned 503 "high demand".
- Tool schemas sent to Gemini may only use string enum values (a numeric enum made every chat fail); `lib/ai/tools.test.ts` guards this. `GEMINI_API_BASE` passed as an empty string by compose must fall back to Google (guarded in `gemini.test.ts`). Gemini failures are logged as `[gemini] ...` in `docker logs hardcode-ops-app` (never the key).
- Tests use a stub Gemini server (`e2e/gemini-stub.ts`); `GEMINI_API_BASE` exists only for that.
- **Ops assistant (migration 0043).** Tools are split by area in `lib/ai/areas/` (tasks, calendar, workshop, sales with institutions/deals/outreach, leave, inventory, insights) and `lib/ai/registry.ts` decides who is offered what. To add a tool: declare it in its area file, add its gate to the area's `writes` map if it drafts a change, handle it in the area's `run`, and for a draft add the kind to `lib/ai/drafts.ts`, the `ai_action.kind` check (new migration), `runDraft` in `lib/actions/assistant.ts` and the labels in `components/assistant/draft-card.tsx`. Tool schemas must keep string enums only. A founder is offered about 40 tools; if Gemini starts choosing the wrong tool, narrow the list per role before touching prompts.
- Chat problem reports: "the assistant says it can't do that" is usually the person's role (the tool is not offered), not a fault. A draft that fails on Confirm shows the same message the form would; fix it in the app, not the assistant.
- Rollback: `docker tag hardcode-ops:pre-opsassistant hardcode-ops:latest` then `docker compose -p operations-crm --env-file .env.local up -d app`. Migration 0043 only widens a check constraint, so it can stay applied.

## Voice mode (Gemini Live)
- A mic button next to Send starts a spoken chat on the same saved key. Needs HTTPS (or localhost) and the browser's microphone permission; the site's `Permissions-Policy` allows the mic for itself only (`microphone=(self)` in `next.config.ts`). Browsers without `getUserMedia` / AudioWorklet do not show the button.
- Flow: the server action `startVoiceSession` decrypts the person's key, picks a Live model (`LIVE_MODEL_PREFERENCE` in `lib/ai/live.ts`, else any model with `bidiGenerateContent`), mints a one-use token (`/v1beta/auth_tokens`, 30 min session, 2 min to connect) and returns the socket URL plus the setup. The browser opens the Google socket directly (CSP `connect-src` allows `wss://generativelanguage.googleapis.com`); the key never reaches the browser. Tool calls come back through `runVoiceTool`, which runs under the person's own session, so voice sees exactly what the person sees.
- Writes are still drafts. The model also has a voice-only `confirm_drafts` tool, and the browser runs it only if the person's latest spoken words (after the draft) are a plain "yes / create / go ahead" (`isSpokenConfirm`), and only for the newest batch of drafts. Tapping Create on the card always works too.
- What is said is saved as ordinary chat messages (`saveVoiceTurn`) so it shows in the chat list; typed "create" later still confirms a spoken draft. Voice turns count toward the 60 messages per hour / 400 per day guard.
- On the call screen: the conversation shows what was said as bubbles with the task cards under the assistant's reply, a two-note chime plays when the call goes live (no chime = the browser's sound is off or blocked; a "Tap to turn the sound on" button appears if the browser suspended audio), and the round button swells with the voice. **The microphone is closed while the assistant speaks** (and for 0.45 s after) because on speakers it hears itself and cuts itself off; tap the circle to interrupt it, or switch on "Talk over it (use headphones)" (remembered in the browser) to talk over it. If someone reports "it only writes, no voice": check device volume and output, the chime, and whether the circle moves while it speaks.
- The call ends after 3 idle minutes, on leaving the page, or when Google closes it; short drops reconnect up to 3 times with the session handle. The mic worklet is served from `/api/voice-worklet` (the image has no `public/` and CSP forbids blob scripts).
- Free keys have small Live allowances; "Your Gemini key hit its voice limit" means wait or use a paid key. Live models on a key: `GET /v1beta/models` and look for `bidiGenerateContent`.
- Tests: `lib/ai/live.test.ts`, `e2e/voice.spec.ts` (the Live socket is scripted with `page.routeWebSocket`, Chromium fake mic; it also checks the speech reaches the audio graph and the mic gating). Not covered by any test: real sound, echo on speakers, phone browsers. Rollback image `hardcode-ops:pre-voice`.

## Incident template
When: / Who noticed: / What people saw: / Cause: / Fix: / What stops it happening again:
(Use the `ops.incident` fields in the app for anything that touched a customer.)

## Restore drill log
(none yet)

## Email notifications (0045)
Every in-app notification can also be mailed. The database decides who gets what (`ops.queue_notification_email`, honouring
`ops.email_pref`) and queues rows in `ops.email_outbox`; `scripts/send-emails.mjs` delivers them through Resend. People choose
what they get on **Account > Email**; the founder sees the queue counts there.

Set up once:
1. Resend: add `hard-code.in`, put the SPF/DKIM records it shows into Cloudflare DNS, wait until it says Verified.
2. Create `~/.config/hardcode-ops/mail.env` (chmod 600, never committed) with `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
   `RESEND_API_KEY`, `MAIL_FROM="Hard-Code Ops <notifications@hard-code.in>"`, `APP_URL=https://ops.hard-code.in`.
3. Apply migration 0045, then install the units: copy `deploy/send-emails.{service,timer}` to `~/.config/systemd/user/`,
   `systemctl --user daemon-reload && systemctl --user enable --now send-emails.timer`.
4. On Account, press "Send a test email". Logs: `journalctl --user -u send-emails`.

Limits and behaviour: the free Resend plan allows 100 mails a day, so the script folds a person's pending notifications into one
mail and stops at 90 mails per rolling 24 hours (`--daily-cap`). Failed mail is retried after 1, 4, 9 and 16 minutes, then marked
failed. A wrong key or unverified domain stops the run and keeps the mail for five minutes without using up tries. Automatic mail
older than a day is dropped as stale.

Two lanes (0046): `notice` is automatic mail from notifications; `direct` is mail a person is waiting for (the test mail now, customer
replies in the shared inbox later). Direct mail is claimed first, is never folded into a digest, and stays valid for 3 days. Of the
90 a day, 30 are reserved for direct mail (`--reserve`), so notices stop at 60 and a busy day of notifications cannot starve a
customer reply. Resend Pro (50,000 a month) removes the pressure; raise `--daily-cap` and lower `--reserve` then.

## Browser notifications (0047)
Same topics as email, delivered as a pop-up on the device (Web Push) and a toast inside an open tab. The database queues one
`ops.push_outbox` row per notification per device (`ops.queue_notification_push`); `scripts/send-push.mjs` (a systemd timer every
10 seconds) delivers them. People turn it on per device on **Account > Browser notifications**. Founder sees the queue counts there.

Set up once:
1. Generate a key pair: `npx web-push generate-vapid-keys --json`. Put `VAPID_PUBLIC_KEY` in `.env.local` (the app reads it at runtime,
   `docker compose` passes it through) and `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:notifications@hard-code.in`
   in `~/.config/hardcode-ops/mail.env`. The private key never goes in the app, `.env.local` or git. Changing the pair turns every
   device off; people switch it on again.
2. Apply migrations 0046 and 0047, rebuild the app (`public/sw.js` is the service worker; `/sw.js` is public and never cached).
3. Install the units: copy `deploy/send-push.{service,timer}` to `~/.config/systemd/user/`,
   `systemctl --user daemon-reload && systemctl --user enable --now send-push.timer`. Logs: `journalctl --user -u send-push`.
4. On Account, switch it on for the device and press "Send a test notification".

Behaviour: a push older than 1 hour is dropped (email is the fallback); a failed send retries after 10, 40 and 90 seconds, then fails;
a device the push service reports gone (404/410) is deleted; devices unseen for 120 days and finished queue rows older than 30 days
are pruned hourly (`prune_outboxes`, run by the email timer). The service worker stays quiet when a tab is open and visible, because
the in-app toast already covers it. Signing out releases that device so a shared computer does not keep showing someone's notifications.
iPhone and iPad are not supported (no installed web app).
