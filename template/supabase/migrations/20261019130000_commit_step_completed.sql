create or replace function agent_chat_api.commit_step(p_run_id uuid, p_step_ordinal integer, p_blocks jsonb, p_final boolean, p_usage jsonb)
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
    if v_run.state = 'completed' and v_run.final_turn_id = (select id from agent_chat.turns where run_id = p_run_id and step_ordinal = p_step_ordinal) then
      return jsonb_build_object('kind', 'completed');
    end if;
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
  if p_final then return jsonb_build_object('kind', 'completed'); end if;
  return jsonb_build_object('kind', 'committed', 'now', v_now);
end;
$$;
