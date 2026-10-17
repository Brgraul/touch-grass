revoke all on all tables in schema account from public, anon, authenticated, service_role;
grant usage on schema account to authenticated, service_role;
grant usage on schema account_api to authenticated, service_role;
grant select on account.profiles to authenticated;
grant select, insert, update on account.profiles to service_role;
revoke execute on all functions in schema account_api from public, anon, authenticated;
grant execute on function account_api.get_profile() to authenticated;
grant execute on function account_api.upsert_profile(uuid, text) to service_role;
