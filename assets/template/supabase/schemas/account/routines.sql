create function account_api.get_profile()
returns table (display_name text, updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select p.display_name, p.updated_at from account.profiles p;
$$;

create function account_api.upsert_profile(p_user_id uuid, p_display_name text)
returns void language sql security invoker set search_path = '' as $$
  insert into account.profiles (user_id, display_name, updated_at)
  values (p_user_id, p_display_name, now())
  on conflict (user_id) do update
  set display_name = excluded.display_name, updated_at = now();
$$;
