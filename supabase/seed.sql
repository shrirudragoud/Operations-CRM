-- Local development only (`supabase start` / `supabase db reset`). Never run against the hosted project.
-- Creates the founder invite for a local test address; sign in at http://localhost:3000 with a magic link
-- and read it in Mailpit (http://127.0.0.1:54324).
insert into ops.invite (email, full_name, role)
values ('founder@hardcode.local', 'Local Founder', 'founder')
on conflict (email) where accepted_at is null do nothing;
