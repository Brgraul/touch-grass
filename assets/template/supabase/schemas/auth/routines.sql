-- Supabase Auth calls this before it creates a user. Admin-created test users skip it.
-- Email stays enabled for test sign-in, so only Google may create users.
create function auth_hooks.before_user_created(event jsonb)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select case
    when event #>> '{user,app_metadata,provider}' = 'google' then '{}'::jsonb
    else jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Sign in with Google.'))
  end;
$$;
