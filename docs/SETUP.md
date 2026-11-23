# Setup: run this CRM for your own company

A fresh install needs your own Supabase project (database, sign-in, file storage) and somewhere to run the app.
Nothing here connects to anyone else's data. The app only talks to the Supabase URL and key you put in `.env.local`.

## What you need
- A free Supabase account (https://supabase.com) and a new project.
- Node.js 22 or newer and npm. Docker is optional (only for the container way of running it).
- This repository.

## 1. Create the database project
1. In Supabase, create a new project. Pick the region closest to your team and save the database password.
2. In the project: **Database > Extensions**, enable **pg_cron** (used by the nightly jobs).

## 2. Load the schema
The whole schema is one file, `supabase/all_migrations.sql` (tables in schema `ops`, row-level security,
business rules, the private `task-files` storage bucket).

Either paste it into **SQL Editor** and run it, or with the Supabase CLI:
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
Then run `supabase/schedules.sql` once in the SQL Editor to start the scheduled jobs (nightly snapshots, retention).

## 3. Expose the `ops` schema
**Settings > Data API > Exposed schemas**: add `ops` next to `public`. Without this every page fails to load data.

## 4. Allow your app URL for sign-in
**Authentication > URL Configuration**:
- Site URL: where the app will run (`http://localhost:3000` for a trial, your real address later).
- Redirect URLs: add `<that address>/auth/callback`.

## 5. Create the first admin (founder)
Access is invite-only. A person who signs in without an invite sees "no access".
1. Open `supabase/seed_founder.sql`, put your own email in place of `YOUR_EMAIL_HERE`, and run it in the SQL Editor.
   This creates a founder invite for that email.
2. **Authentication > Users > Add user**: create a user with the same email and a password, with **Auto Confirm User** on.
3. Sign in to the app with that email and password. Your first sign-in turns the invite into the founder account.

Everyone else is invited from the app's **Team** page (email, role, departments). For each person either create their
user the same way in step 2, or switch on one of the options below so they can sign in themselves.

### Optional sign-in methods
The login page offers password, email link and Google.
- **Email link** works out of the box, but Supabase's built-in mailer allows only a few emails an hour.
  For a real team set up custom SMTP (Resend, Brevo, SES, ...) under **Authentication > Emails > SMTP Settings**.
- **Google**: create an OAuth client in Google Cloud, then enter its client ID and secret under
  **Authentication > Providers > Google**. Add the callback URL Supabase shows to the Google client.

## 6. Configure the app
```bash
cp .env.example .env.local
```
Fill in two values from **Settings > API** (URL) and **Settings > API Keys** (publishable key):
```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```
These are baked in when the app is built, so rebuild after changing them. Never put the secret / service-role key in this file.

Optional, in the same file:
- `AI_KEY_SECRET`: switches on the Assistant. Generate with `openssl rand -base64 32` and keep a copy somewhere safe.
- `TASK_FILE_SCAN=required`: virus-scan every upload (needs the ClamAV container, see `docs/RUNBOOK.md`).

## 7. Run it
**With Node:**
```bash
npm install
npm run build
npm start            # http://localhost:3000
```
For development use `npm run dev` instead of build and start.

**With Docker:**
```bash
docker compose --env-file .env.local up -d --build app    # http://127.0.0.1:3400
```
Put a reverse proxy or tunnel with HTTPS in front of it if people will use it from other machines
(Google sign-in and the Assistant's voice mode need HTTPS). Set the Site URL and redirect URL in step 4 to that address.
`docker-compose.yml` has an MTU setting for one specific office network; remove it if you do not need it.

## 8. Check it works
1. Open the app and sign in as the founder. You should land on **My day** with the full sidebar.
2. Open **Team**, invite a test person, and sign in as them in a private window. They should only see their areas.
3. `GET /api/health` returns `{"status":"ok","db":true}`.

## Things built for the original company
You will want to change these:
- Branding ("Hard-Code") in the login page, sidebar and layout.
- India time zone and a Monday week start.
- Attendance is tied to a trusted office network. Set yours under Attendance > Settings, or leave attendance off.
- The department list (Outreach, Workshop, Inventory, ...) is part of the schema. Changing it means a new migration.

## Updating later
Pull the new code, apply any new files from `supabase/migrations/` (in order) with `npx supabase db push` or the SQL Editor,
then rebuild the app. Back up your data before applying migrations. Never edit a migration that is already applied.

## Useful commands
| Command | What |
| --- | --- |
| `npm run lint` / `npm run typecheck` / `npm test` | ESLint, TypeScript, unit tests |
| `npm run test:db` | Database rules and row-level security checks, no Supabase needed |
| `npx supabase start` | A throwaway local Supabase stack for trying things safely (see README quick start) |

More detail: `docs/ARCHITECTURE.md`, `docs/ACCESS_MODEL.md`, `docs/RUNBOOK.md`.
