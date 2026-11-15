-- Run ONCE after applying all migrations. Replace the email with the Google account
-- you will sign in with. When you first sign in, ops.claim_access() turns this invite
-- into your founder staff row. Everyone else is invited from the app's Team page.
insert into ops.invite (email, full_name, role)
values (lower('YOUR_EMAIL_HERE'), 'Founder', 'founder')
on conflict (email) where accepted_at is null do update set role = 'founder';
