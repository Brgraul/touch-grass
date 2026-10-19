alter table account.profiles enable row level security;
create policy profiles_owner_read on account.profiles
  for select to authenticated using (user_id = (select auth.uid()));
