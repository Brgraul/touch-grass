create or replace function agent_chat_api.start_run(p_run_id uuid, p_max_history_runs integer, p_max_history_bytes integer)
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
    'runId', v_run.id, 'ownerId', v_run.owner_id, 'conversationId', v_run.conversation_id, 'message', v_run.message,
    'history', v_history, 'policy', v_run.policy, 'deadline', v_run.deadline));
end;
$$;
