create schema auth_hooks;

-- Supabase Auth calls this before it creates a user. Admin-created test users skip it.
-- Email stays enabled for test sign-in, so only Google may create users.
create function auth_hooks.before_user_created(event jsonb)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select case
    when event #>> '{user,app_metadata,provider}' = 'google' then '{}'::jsonb
    else jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Sign in with Google.'))
  end;
$$;

grant usage on schema auth_hooks to supabase_auth_admin;
revoke execute on all functions in schema auth_hooks from public, anon, authenticated, service_role;
grant execute on function auth_hooks.before_user_created(jsonb) to supabase_auth_admin;

create schema account;
create schema account_api;

create table account.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  updated_at timestamptz not null default now()
);

alter table account.profiles enable row level security;
create policy profiles_owner_read on account.profiles
  for select to authenticated using (user_id = (select auth.uid()));

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

revoke all on all tables in schema account from public, anon, authenticated, service_role;
grant usage on schema account to authenticated, service_role;
grant usage on schema account_api to authenticated, service_role;
grant select on account.profiles to authenticated;
grant select, insert, update on account.profiles to service_role;
revoke execute on all functions in schema account_api from public, anon, authenticated;
grant execute on function account_api.get_profile() to authenticated;
grant execute on function account_api.upsert_profile(uuid, text) to service_role;

create schema agent_chat;
create schema agent_chat_api;
do $$ begin
  if not exists (select from pg_roles where rolname = 'agent_chat_committer') then
    create role agent_chat_committer nologin noinherit;
  end if;
end $$;
grant agent_chat_committer to postgres;

create table agent_chat.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table agent_chat.runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  environment_id uuid not null,
  message text not null check (octet_length(message) between 1 and 32768),
  request_key uuid not null,
  input_hash text not null,
  policy jsonb not null,
  deadline timestamptz not null,
  version integer not null default 1 check (version > 0),
  state text not null default 'queued' check (state in ('queued', 'running', 'completed', 'failed', 'canceled')),
  failure jsonb,
  committed_steps integer not null default 0 check (committed_steps >= 0),
  final_turn_id uuid,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (owner_id, request_key),
  unique (id, owner_id),
  foreign key (conversation_id, owner_id) references agent_chat.conversations(id, owner_id) on delete cascade,
  check ((ended_at is not null) = (state in ('completed', 'failed', 'canceled'))),
  check ((final_turn_id is not null) = (state = 'completed')),
  check ((failure is not null) = (state = 'failed')),
  check (jsonb_typeof(policy) = 'object' and (policy->>'maxSteps')::integer > 0
    and (policy->>'maxToolCallsPerStep')::integer > 0)
);

create table agent_chat.turns (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  step_ordinal integer not null check (step_ordinal > 0),
  blocks jsonb not null check (jsonb_typeof(blocks) = 'array'),
  block_schema_version integer not null,
  created_at timestamptz not null default now(),
  unique (run_id, step_ordinal),
  unique (id, run_id),
  foreign key (run_id, owner_id) references agent_chat.runs(id, owner_id) on delete cascade
);

alter table agent_chat.runs add constraint final_turn_belongs_to_run
  foreign key (final_turn_id, id) references agent_chat.turns(id, run_id) deferrable initially deferred;

create index conversations_owner_recent on agent_chat.conversations(owner_id, updated_at desc, id desc);
create index runs_conversation_recent on agent_chat.runs(conversation_id, created_at desc, id desc);
create index runs_owner_recent on agent_chat.runs(owner_id, created_at);
create index runs_environment_active on agent_chat.runs(environment_id) where state in ('queued', 'running');
create index turns_owner on agent_chat.turns(owner_id);

alter table agent_chat.conversations enable row level security;
alter table agent_chat.runs enable row level security;
alter table agent_chat.turns enable row level security;
create policy conversations_owner_read on agent_chat.conversations
  for select to authenticated using (owner_id = (select auth.uid()));
create policy runs_owner_read on agent_chat.runs
  for select to authenticated using (owner_id = (select auth.uid()));
create policy turns_owner_read on agent_chat.turns
  for select to authenticated using (owner_id = (select auth.uid()));
create policy committer_conversations_read on agent_chat.conversations
  for select to agent_chat_committer using (true);
create policy committer_conversations_update on agent_chat.conversations
  for update to agent_chat_committer using (true) with check (true);
create policy committer_runs_read on agent_chat.runs
  for select to agent_chat_committer using (true);
create policy committer_runs_update on agent_chat.runs
  for update to agent_chat_committer using (true) with check (true);
create policy committer_turns_read on agent_chat.turns
  for select to agent_chat_committer using (true);
create policy committer_turns_insert on agent_chat.turns
  for insert to agent_chat_committer with check (true);

create function agent_chat.run_json(p_run agent_chat.runs)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', p_run.id, 'conversationId', p_run.conversation_id, 'message', p_run.message,
    'version', p_run.version, 'createdAt', p_run.created_at, 'state', p_run.state
  ) || case p_run.state
    when 'running' then jsonb_build_object('committedSteps', p_run.committed_steps)
    when 'completed' then jsonb_build_object('finalTurn', p_run.final_turn_id, 'endedAt', p_run.ended_at)
    when 'failed' then jsonb_build_object('failure', p_run.failure, 'endedAt', p_run.ended_at)
    when 'canceled' then jsonb_build_object('endedAt', p_run.ended_at)
    else '{}'::jsonb end;
$$;

create function agent_chat.turn_json(p_turn agent_chat.turns)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('id', p_turn.id, 'runId', p_turn.run_id, 'step', p_turn.step_ordinal,
    'blocks', p_turn.blocks, 'blockSchemaVersion', p_turn.block_schema_version, 'createdAt', p_turn.created_at);
$$;

create function agent_chat.exchange_json(p_run agent_chat.runs)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('run', agent_chat.run_json(p_run), 'turns', coalesce((
    select jsonb_agg(agent_chat.turn_json(t) order by t.step_ordinal)
    from agent_chat.turns t where t.run_id = p_run.id
  ), '[]'::jsonb));
$$;

create function agent_chat.cursor_encode(p_time timestamptz, p_id uuid)
returns text language sql immutable security invoker set search_path = '' as $$
  select rtrim(translate(replace(encode(convert_to(jsonb_build_array(p_time, p_id)::text, 'UTF8'), 'base64'), E'\n', ''), '+/', '-_'), '=');
$$;

create function agent_chat.cursor_decode(p_after text)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare v_cursor jsonb;
begin
  if p_after is null then return null; end if;
  begin
    v_cursor := convert_from(decode(translate(p_after, '-_', '+/') || repeat('=', (4 - length(p_after) % 4) % 4), 'base64'), 'UTF8')::jsonb;
    if jsonb_typeof(v_cursor) <> 'array' or jsonb_array_length(v_cursor) <> 2 then
      raise exception 'invalid cursor';
    end if;
    perform (v_cursor->>0)::timestamptz, (v_cursor->>1)::uuid;
    return v_cursor;
  exception when others then
    raise exception 'invalid_page_cursor' using errcode = '22023';
  end;
end;
$$;

create function agent_chat_api.submit_message(
  p_owner_id uuid, p_environment_id uuid, p_request_key uuid, p_text text,
  p_max_steps integer, p_max_tool_calls_per_step integer,
  p_messages_per_hour integer, p_active_per_user integer, p_active_per_environment integer,
  p_run_duration_seconds integer, p_conversation_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_run agent_chat.runs;
  v_conversation_id uuid := p_conversation_id;
  v_hash text := encode(sha256(convert_to(jsonb_build_array(p_conversation_id, p_text)::text, 'UTF8')), 'hex');
  v_now timestamptz;
begin
  if p_owner_id is null or p_environment_id is null or p_request_key is null
    or p_text is null or octet_length(p_text) not between 1 and 32768
    or p_max_steps is null or p_max_tool_calls_per_step is null
    or p_messages_per_hour is null or p_active_per_user is null or p_active_per_environment is null
    or p_run_duration_seconds is null or p_max_steps <= 0 or p_max_tool_calls_per_step <= 0
    or p_messages_per_hour <= 0 or p_active_per_user <= 0 or p_active_per_environment <= 0
    or p_run_duration_seconds <= 0 then
    raise exception 'invalid_message_input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_environment_id::text, 0));
  v_now := clock_timestamp();
  select * into v_run from agent_chat.runs where owner_id = p_owner_id and request_key = p_request_key;
  if found then
    if v_run.input_hash <> v_hash then return jsonb_build_object('kind', 'key_conflict'); end if;
    return jsonb_build_object('kind', 'accepted', 'run', agent_chat.run_json(v_run), 'created', false);
  end if;
  if v_conversation_id is not null and not exists (
    select from agent_chat.conversations where id = v_conversation_id and owner_id = p_owner_id
  ) then return jsonb_build_object('kind', 'not_found'); end if;
  if (select count(*) from agent_chat.runs where owner_id = p_owner_id and created_at >= v_now - interval '1 hour') >= p_messages_per_hour then
    return jsonb_build_object('kind', 'refused', 'reason', 'rate_limited');
  end if;
  if exists (select from agent_chat.runs where conversation_id = v_conversation_id and state in ('queued', 'running')) then
    return jsonb_build_object('kind', 'refused', 'reason', 'busy');
  end if;
  if (select count(*) from agent_chat.runs where owner_id = p_owner_id and state in ('queued', 'running')) >= p_active_per_user
    or (select count(*) from agent_chat.runs where environment_id = p_environment_id and state in ('queued', 'running')) >= p_active_per_environment then
    return jsonb_build_object('kind', 'refused', 'reason', 'capacity');
  end if;
  if v_conversation_id is null then
    insert into agent_chat.conversations(owner_id, title, created_at, updated_at)
    values (p_owner_id, left(p_text, 80), v_now, v_now) returning id into v_conversation_id;
  end if;
  insert into agent_chat.runs(conversation_id, owner_id, environment_id, message, request_key,
    input_hash, policy, deadline, created_at)
  values (v_conversation_id, p_owner_id, p_environment_id, p_text, p_request_key, v_hash,
    jsonb_build_object('maxSteps', p_max_steps, 'maxToolCallsPerStep', p_max_tool_calls_per_step),
    v_now + make_interval(secs => p_run_duration_seconds), v_now)
  returning * into v_run;
  update agent_chat.conversations set updated_at = v_now where id = v_conversation_id;
  return jsonb_build_object('kind', 'accepted', 'run', agent_chat.run_json(v_run), 'created', true);
end;
$$;

create function agent_chat_api.cancel_run(p_owner_id uuid, p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_run agent_chat.runs;
begin
  select * into v_run from agent_chat.runs where id = p_run_id and owner_id = p_owner_id for update;
  if not found then return jsonb_build_object('kind', 'not_found'); end if;
  if v_run.state in ('queued', 'running') then
    update agent_chat.runs set state = 'canceled', ended_at = clock_timestamp(), version = version + 1
    where id = p_run_id returning * into v_run;
  end if;
  return agent_chat.run_json(v_run);
end;
$$;

create function agent_chat_api.start_run(p_run_id uuid, p_max_history_runs integer, p_max_history_bytes integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_run agent_chat.runs;
  v_prior agent_chat.runs;
  v_history jsonb := '[]'::jsonb;
  v_exchange jsonb;
  v_bytes integer := 2;
  v_now timestamptz;
begin
  select * into v_run from agent_chat.runs where id = p_run_id for update;
  v_now := clock_timestamp();
  if not found or v_run.state not in ('queued', 'running') then
    return jsonb_build_object('kind', 'ended');
  end if;
  if v_now >= v_run.deadline then
    update agent_chat.runs set state = 'failed', failure = '{"kind":"limit","limit":"duration"}',
      ended_at = v_now, version = version + 1 where id = p_run_id;
    return jsonb_build_object('kind', 'ended');
  end if;
  if v_run.state = 'queued' then
    update agent_chat.runs set state = 'running', version = version + 1
      where id = p_run_id returning * into v_run;
  end if;
  for v_prior in select * from agent_chat.runs
    where conversation_id = v_run.conversation_id and state = 'completed'
    order by created_at desc, id desc limit greatest(p_max_history_runs, 0)
  loop
    v_exchange := agent_chat.exchange_json(v_prior);
    if v_bytes + octet_length(v_exchange::text) + 1 > p_max_history_bytes then exit; end if;
    v_history := jsonb_build_array(v_exchange) || v_history;
    v_bytes := v_bytes + octet_length(v_exchange::text) + 1;
  end loop;
  return jsonb_build_object('kind', 'started', 'now', v_now, 'input', jsonb_build_object(
    'runId', v_run.id, 'ownerId', v_run.owner_id, 'message', v_run.message,
    'history', v_history, 'policy', v_run.policy, 'deadline', v_run.deadline));
end;
$$;

create function agent_chat.validate_blocks(p_blocks jsonb)
returns void language plpgsql immutable security invoker set search_path = '' as $$
declare v_block jsonb;
begin
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) > 64
    or octet_length(p_blocks::text) > 262144 then
    raise exception 'invalid_turn_blocks' using errcode = '22023';
  end if;
  for v_block in select value from jsonb_array_elements(p_blocks) loop
    if jsonb_typeof(v_block) <> 'object' or v_block->>'kind' is null then
      raise exception 'invalid_turn_block' using errcode = '22023';
    end if;
    case v_block->>'kind'
      when 'text' then
        if jsonb_typeof(v_block->'text') is distinct from 'string' or octet_length(v_block->>'text') > 32768 then
          raise exception 'invalid_text_block' using errcode = '22023';
        end if;
      when 'tool_call' then
        if jsonb_typeof(v_block->'callId') is distinct from 'string' or jsonb_typeof(v_block->'tool') is distinct from 'string'
          or not v_block ? 'input' or octet_length((v_block->'input')::text) > 16384 then
          raise exception 'invalid_tool_call' using errcode = '22023';
        end if;
      when 'tool_result' then
        if jsonb_typeof(v_block->'callId') is distinct from 'string' or jsonb_typeof(v_block->'isError') is distinct from 'boolean'
          or not v_block ? 'output' or octet_length((v_block->'output')::text) > 16384
          or not exists (select from jsonb_array_elements(p_blocks) b where b->>'kind' = 'tool_call' and b->>'callId' = v_block->>'callId') then
          raise exception 'unpaired_or_invalid_tool_result' using errcode = '22023';
        end if;
      when 'structured_output' then
        if jsonb_typeof(v_block->'schema') is distinct from 'string' or not v_block ? 'value'
          or octet_length((v_block->'value')::text) > 16384 then
          raise exception 'invalid_structured_output' using errcode = '22023';
        end if;
      else raise exception 'unsupported_write_block' using errcode = '22023';
    end case;
  end loop;
end;
$$;

create function agent_chat_api.commit_step(p_run_id uuid, p_step_ordinal integer, p_blocks jsonb, p_final boolean, p_usage jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_run agent_chat.runs;
  v_turn_id uuid;
  v_now timestamptz;
begin
  select * into v_run from agent_chat.runs where id = p_run_id for update;
  v_now := clock_timestamp();
  if not found then return jsonb_build_object('kind', 'ended'); end if;
  if exists (select from agent_chat.turns where run_id = p_run_id and step_ordinal = p_step_ordinal) then
    if v_run.state in ('completed', 'failed', 'canceled') then return jsonb_build_object('kind', 'ended'); end if;
    return jsonb_build_object('kind', 'committed', 'now', v_now);
  end if;
  if v_run.state in ('completed', 'failed', 'canceled') then return jsonb_build_object('kind', 'ended'); end if;
  if v_now >= v_run.deadline then
    update agent_chat.runs set state = 'failed', failure = '{"kind":"limit","limit":"duration"}',
      ended_at = v_now, version = version + 1 where id = p_run_id;
    return jsonb_build_object('kind', 'ended');
  end if;
  if v_run.state <> 'running' or p_step_ordinal <> v_run.committed_steps + 1
    or p_step_ordinal > (v_run.policy->>'maxSteps')::integer then
    raise exception 'invalid_step_ordinal' using errcode = '22023';
  end if;
  perform agent_chat.validate_blocks(p_blocks);
  if p_usage is null or jsonb_typeof(p_usage) <> 'object' or (p_usage->>'inputTokens')::bigint < 0
    or (p_usage->>'outputTokens')::bigint < 0 or not (p_usage ? 'inputTokens' and p_usage ? 'outputTokens') then
    raise exception 'invalid_token_usage' using errcode = '22023';
  end if;
  insert into agent_chat.turns(run_id, owner_id, step_ordinal, blocks, block_schema_version, created_at)
    values (p_run_id, v_run.owner_id, p_step_ordinal, p_blocks, 1, v_now) returning id into v_turn_id;
  update agent_chat.runs set committed_steps = committed_steps + 1,
    input_tokens = input_tokens + (p_usage->>'inputTokens')::bigint,
    output_tokens = output_tokens + (p_usage->>'outputTokens')::bigint,
    version = version + 1, state = case when p_final then 'completed' else 'running' end,
    final_turn_id = case when p_final then v_turn_id else null end,
    ended_at = case when p_final then v_now else null end where id = p_run_id;
  update agent_chat.conversations set updated_at = v_now where id = v_run.conversation_id;
  if p_final then return jsonb_build_object('kind', 'ended'); end if;
  return jsonb_build_object('kind', 'committed', 'now', v_now);
end;
$$;

create function agent_chat_api.fail_run(p_run_id uuid, p_failure jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_run agent_chat.runs;
begin
  select * into v_run from agent_chat.runs where id = p_run_id for update;
  if not found then return jsonb_build_object('kind', 'not_found'); end if;
  if v_run.state in ('queued', 'running') then
    update agent_chat.runs set state = 'failed', failure = case when clock_timestamp() >= deadline
      then '{"kind":"limit","limit":"duration"}'::jsonb else p_failure end, ended_at = clock_timestamp(), version = version + 1
      where id = p_run_id returning * into v_run;
  end if;
  return agent_chat.run_json(v_run);
end;
$$;

create function agent_chat_api.sweep_candidates(p_environment_id uuid, p_dispatch_delay_seconds integer, p_end_grace_seconds integer, p_limit integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('dispatch', coalesce((
    select jsonb_agg(q.id order by q.created_at, q.id) from (
      select id, created_at from agent_chat.runs where environment_id = p_environment_id and state = 'queued'
        and created_at < now() - make_interval(secs => p_dispatch_delay_seconds)
        and now() < deadline + make_interval(secs => p_end_grace_seconds)
      order by created_at, id limit least(greatest(p_limit, 0), 25)
    ) q
  ), '[]'::jsonb), 'expired', coalesce((
    select jsonb_agg(q.id order by q.deadline, q.id) from (
      select id, deadline from agent_chat.runs where environment_id = p_environment_id and state in ('queued', 'running')
        and now() >= deadline + make_interval(secs => p_end_grace_seconds)
      order by deadline, id limit least(greatest(p_limit, 0), 25)
    ) q
  ), '[]'::jsonb));
$$;

create function agent_chat_api.list_conversations(p_after text default null, p_limit integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_cursor jsonb := agent_chat.cursor_decode(p_after);
  v_items jsonb;
  v_next text;
  v_limit integer := least(greatest(p_limit, 1), 50);
begin
  with page as (
    select * from agent_chat.conversations
    where v_cursor is null or (updated_at, id) < ((v_cursor->>0)::timestamptz, (v_cursor->>1)::uuid)
    order by updated_at desc, id desc limit v_limit + 1
  ), numbered as (
    select *, row_number() over (order by updated_at desc, id desc) as ordinal from page
  ) select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'updatedAt', updated_at)
      order by updated_at desc, id desc) filter (where ordinal <= v_limit), '[]'::jsonb),
    case when count(*) > v_limit then max(agent_chat.cursor_encode(updated_at, id)) filter (where ordinal = v_limit) end
    into v_items, v_next from numbered;
  return jsonb_build_object('items', v_items) || case when v_next is null then '{}'::jsonb else jsonb_build_object('next', v_next) end;
end;
$$;

create function agent_chat_api.read_conversation(p_conversation_id uuid, p_after text default null, p_limit integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_conversation agent_chat.conversations;
  v_cursor jsonb := agent_chat.cursor_decode(p_after);
  v_items jsonb;
  v_next text;
  v_limit integer := least(greatest(p_limit, 1), 50);
begin
  select * into v_conversation from agent_chat.conversations where id = p_conversation_id;
  if not found then return jsonb_build_object('kind', 'not_found'); end if;
  with page as (
    select r.* from agent_chat.runs r where r.conversation_id = p_conversation_id
      and (v_cursor is null or (r.created_at, r.id) < ((v_cursor->>0)::timestamptz, (v_cursor->>1)::uuid))
    order by r.created_at desc, r.id desc limit v_limit + 1
  ), numbered as (
    select p.*, row_number() over (order by p.created_at desc, p.id desc) as ordinal from page p
  ) select coalesce(jsonb_agg(agent_chat.exchange_json(r) order by r.created_at desc, r.id desc)
      filter (where n.ordinal <= v_limit), '[]'::jsonb),
    case when count(*) > v_limit then max(agent_chat.cursor_encode(r.created_at, r.id)) filter (where n.ordinal = v_limit) end
    into v_items, v_next from numbered n join agent_chat.runs r on r.id = n.id;
  return jsonb_build_object('conversation', jsonb_build_object('id', v_conversation.id, 'title', v_conversation.title,
    'updatedAt', v_conversation.updated_at), 'exchanges', jsonb_build_object('items', v_items)
      || case when v_next is null then '{}'::jsonb else jsonb_build_object('next', v_next) end);
end;
$$;

revoke all on all tables in schema agent_chat from public, anon, authenticated, service_role;
grant usage on schema agent_chat, agent_chat_api to authenticated, service_role, agent_chat_committer;
grant select on all tables in schema agent_chat to authenticated;
grant select, insert, update on agent_chat.conversations, agent_chat.runs to service_role;
grant select on agent_chat.turns to service_role;
grant select, update on agent_chat.conversations, agent_chat.runs to agent_chat_committer;
grant select, insert on agent_chat.turns to agent_chat_committer;
revoke execute on all functions in schema agent_chat from public, anon, authenticated, service_role;
grant execute on function agent_chat.run_json(agent_chat.runs), agent_chat.turn_json(agent_chat.turns),
  agent_chat.exchange_json(agent_chat.runs), agent_chat.cursor_encode(timestamptz, uuid), agent_chat.cursor_decode(text)
  to authenticated, service_role, agent_chat_committer;
grant execute on function agent_chat.validate_blocks(jsonb) to agent_chat_committer;
revoke execute on all functions in schema agent_chat_api from public, anon, authenticated, service_role;
grant execute on function
  agent_chat_api.submit_message(uuid, uuid, uuid, text, integer, integer, integer, integer, integer, integer, uuid),
  agent_chat_api.cancel_run(uuid, uuid), agent_chat_api.start_run(uuid, integer, integer),
  agent_chat_api.commit_step(uuid, integer, jsonb, boolean, jsonb), agent_chat_api.fail_run(uuid, jsonb),
  agent_chat_api.sweep_candidates(uuid, integer, integer, integer) to service_role;
grant execute on function agent_chat_api.list_conversations(text, integer),
  agent_chat_api.read_conversation(uuid, text, integer) to authenticated;
grant create on schema agent_chat_api to agent_chat_committer;
alter function agent_chat_api.commit_step(uuid, integer, jsonb, boolean, jsonb) owner to agent_chat_committer;
revoke create on schema agent_chat_api from agent_chat_committer;

