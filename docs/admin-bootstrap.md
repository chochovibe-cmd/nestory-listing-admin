# Admin Bootstrap

All new Supabase Auth users are created as `operator` by default. This is safer
than allowing users to self-promote in the PWA, but the first team admin must be
bootstrapped manually.

## Safe First Admin Setup

1. Create or invite the first owner account in Supabase Auth.
2. Confirm the user exists in `auth.users`.
3. Confirm `public.profiles` has a row for the user. The migration trigger
   `handle_new_user()` creates it automatically.
4. In Supabase SQL Editor, run this with the owner's email:

```sql
update public.profiles
set role = 'admin'
where email = 'OWNER_EMAIL@example.com';
```

5. Confirm exactly one row changed:

```sql
select id, email, role
from public.profiles
where email = 'OWNER_EMAIL@example.com';
```

## Adding Reviewers

After the first admin exists, use an admin-only backend action or Supabase SQL
Editor to promote trusted reviewers:

```sql
update public.profiles
set role = 'reviewer'
where email = 'REVIEWER_EMAIL@example.com';
```

## What Not To Do

- Do not expose role promotion in the public frontend.
- Do not add role values to local storage or client-side-only state.
- Do not commit service role keys to perform role setup.
- Do not make every new user an admin by default.

## Future Improvement

Add an admin-only team settings page after v0.1 can run against a test Supabase
project and the basic RLS checks have been verified.
