begin;
select '1..1';

do $$
declare
  denied boolean := false;
begin
  assert auth_hooks.before_user_created('{"user":{"app_metadata":{"provider":"google"}}}') = '{}'::jsonb, 'Google sign-up is allowed';
  assert auth_hooks.before_user_created('{"user":{"app_metadata":{"provider":"email"}}}') #>> '{error,http_code}' = '403', 'email sign-up is rejected';
  assert auth_hooks.before_user_created('{"user":{"app_metadata":{}}}') #>> '{error,http_code}' = '403', 'anonymous sign-up is rejected';
  assert has_function_privilege('supabase_auth_admin', 'auth_hooks.before_user_created(jsonb)', 'execute'), 'Auth can call the hook';
  assert not has_function_privilege('authenticated', 'auth_hooks.before_user_created(jsonb)', 'execute'), 'signed-in users cannot call the hook';
  assert not has_function_privilege('anon', 'auth_hooks.before_user_created(jsonb)', 'execute'), 'visitors cannot call the hook';
end;
$$;

select 'ok 1 - only Google creates users';
rollback;
