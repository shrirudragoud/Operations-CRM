-- Run ONCE, after you have signed in to the app (or created a user in
-- Authentication > Users). Replace the email with your own sign-in email.
insert into ops.staff (id, full_name, email, role)
select id, 'Founder', email, 'founder'
from auth.users
where email = 'YOUR_EMAIL_HERE'
on conflict (id) do update set role = 'founder', is_active = true;
