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
