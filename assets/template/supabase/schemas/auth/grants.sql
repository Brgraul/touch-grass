grant usage on schema auth_hooks to supabase_auth_admin;
revoke execute on all functions in schema auth_hooks from public, anon, authenticated, service_role;
grant execute on function auth_hooks.before_user_created(jsonb) to supabase_auth_admin;
