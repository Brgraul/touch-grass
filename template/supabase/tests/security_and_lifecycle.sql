begin;
select '1..1';

insert into auth.users(id, email) values
  ('10000000-0000-4000-8000-000000000001', 'template-sql-a@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'template-sql-b@example.test');

do $$
declare
  a uuid := '10000000-0000-4000-8000-000000000001';
  b uuid := '10000000-0000-4000-8000-000000000002';
  env_id uuid := '20000000-0000-4000-8000-000000000001';
  key_id uuid := gen_random_uuid();
  receipt jsonb;
  duplicate jsonb;
  result jsonb;
  v_run_id uuid;
  conversation_id uuid;
  before_version integer;
  denied boolean := false;
  cursor_value text;
  v_routine text;
begin
  set local role service_role;
  perform account_api.upsert_profile(a, 'Alice');
  receipt := agent_chat_api.submit_message(a, env_id, key_id, 'calculate 2 + 2', 8, 4, 60, 2, 10, 900, null);
  assert receipt->>'kind' = 'accepted' and (receipt->>'created')::boolean, 'a message is admitted';
  v_run_id := (receipt#>>'{run,id}')::uuid;
  conversation_id := (receipt#>>'{run,conversationId}')::uuid;
  duplicate := agent_chat_api.submit_message(a, env_id, key_id, 'calculate 2 + 2', 8, 4, 60, 2, 10, 900, null);
  assert duplicate#>>'{run,id}' = v_run_id::text and not (duplicate->>'created')::boolean, 'transport retry returns the same run';
  result := agent_chat_api.submit_message(a, env_id, key_id, 'changed', 8, 4, 60, 2, 10, 900, null);
  assert result->>'kind' = 'key_conflict', 'changed input conflicts with the original request key';
  result := agent_chat_api.submit_message(a, env_id, gen_random_uuid(), 'again', 8, 4, 60, 2, 10, 900, conversation_id);
  assert result->>'reason' = 'busy', 'one active run per conversation';
  result := agent_chat_api.submit_message(b, env_id, gen_random_uuid(), 'stolen', 8, 4, 60, 2, 10, 900, conversation_id);
  assert result->>'kind' = 'not_found', 'submit checks conversation ownership in SQL';
  result := agent_chat_api.cancel_run(b, v_run_id);
  assert result->>'kind' = 'not_found', 'cancel checks run ownership in SQL';
  result := agent_chat_api.submit_message(a, env_id, gen_random_uuid(), 'over window', 8, 4, 1, 2, 10, 900, null);
  assert result->>'reason' = 'rate_limited', 'hourly limit refuses before inserting';
  assert (select count(*) from agent_chat.runs where owner_id = a) = 1, 'refusals create no rows';
  result := agent_chat_api.submit_message(a, env_id, gen_random_uuid(), 'over user capacity', 8, 4, 60, 1, 10, 900, null);
  assert result->>'reason' = 'capacity', 'per-user capacity is enforced';
  result := agent_chat_api.submit_message(b, env_id, gen_random_uuid(), 'over environment capacity', 8, 4, 60, 2, 1, 900, null);
  assert result->>'reason' = 'capacity', 'environment capacity is enforced';
  begin
    perform agent_chat_api.submit_message(a, env_id, gen_random_uuid(), repeat('x', 32769), 8, 4, 60, 2, 10, 900, null);
  exception when invalid_parameter_value then denied := true;
  end;
  assert denied, 'a message over 32 KB is rejected';
  assert (select count(*) from agent_chat.runs where owner_id = a) = 1, 'a rejected message creates no row';
  denied := false;
  result := agent_chat_api.start_run(v_run_id, 20, 524288);
  assert result->>'kind' = 'started' and result#>>'{input,runId}' = v_run_id::text, 'start returns the run and frozen history';
  assert result#>'{input,policy}' = '{"maxSteps":8,"maxToolCallsPerStep":4}', 'policy snapshot survives admission';
  assert result#>>'{input,conversationId}' = (select r.conversation_id::text from agent_chat.runs r where r.id = v_run_id),
    'start returns the run''s conversation';
  result := agent_chat_api.commit_step(v_run_id, 1, '[{"kind":"tool_call","callId":"call-1","tool":"calculate","input":{"expression":"2+2"}},{"kind":"tool_result","callId":"call-1","output":{"value":4},"isError":false}]', false, '{"inputTokens":10,"outputTokens":5}');
  assert result->>'kind' = 'committed', 'a nonfinal step commits';
  select version into before_version from agent_chat.runs where id = v_run_id;
  result := agent_chat_api.commit_step(v_run_id, 1, '[]', false, '{"inputTokens":999,"outputTokens":999}');
  assert (select count(*) from agent_chat.turns t where t.run_id = v_run_id) = 1, 'a repeated commit retains one turn';
  assert (select version from agent_chat.runs where id = v_run_id) = before_version, 'a repeated commit changes no run version';
  assert (select input_tokens from agent_chat.runs where id = v_run_id) = 10, 'a repeated commit charges no usage';
  begin
    perform agent_chat_api.commit_step(v_run_id, 2, '[{"kind":"tool_result","callId":"orphan","output":4,"isError":false}]', true, '{"inputTokens":1,"outputTokens":1}');
  exception when invalid_parameter_value then denied := true;
  end;
  assert denied, 'unpaired tool results are rejected';
  denied := false;
  begin
    perform agent_chat_api.commit_step(v_run_id, 2, '[{"kind":"unsupported","storedKind":"future","storedVersion":1}]', true, '{"inputTokens":1,"outputTokens":1}');
  exception when invalid_parameter_value then denied := true;
  end;
  assert denied, 'unsupported is a read-only block kind';
  denied := false;
  begin
    insert into agent_chat.turns(run_id, owner_id, step_ordinal, blocks, block_schema_version)
    values (v_run_id, a, 2, '[]', 1);
  exception when insufficient_privilege then denied := true;
  end;
  assert denied, 'service_role cannot forge an agent turn';
  result := agent_chat_api.commit_step(v_run_id, 2, '[{"kind":"text","text":"4"}]', true, '{"inputTokens":12,"outputTokens":1}');
  assert result->>'kind' = 'completed', 'final commit returns completed';
  result := agent_chat_api.commit_step(v_run_id, 2, '[{"kind":"text","text":"4"}]', true, '{"inputTokens":12,"outputTokens":1}');
  assert result->>'kind' = 'completed', 'a repeated final commit returns completed again';
  result := agent_chat_api.cancel_run(a, v_run_id);
  assert result->>'state' = 'completed' and result->>'finalTurn' is not null, 'completion atomically stores its final turn and wins later cancellation';
  result := agent_chat_api.fail_run(v_run_id, '{"kind":"execution","code":"internal"}');
  assert result->>'state' = 'completed', 'completion wins later failure';
  assert (select count(*) from agent_chat.turns t where t.run_id = v_run_id) = 2, 'replays and invalid commits write no extra turn';
  reset role;

  assert (select count(*) from pg_proc p join pg_roles r on r.oid = p.proowner where r.rolname = 'agent_chat_committer') = 1, 'committer owns exactly one routine';
  assert not has_table_privilege('service_role', 'agent_chat.turns', 'INSERT'), 'service has no turn insert privilege';
  assert not has_table_privilege('service_role', 'agent_chat.turns', 'UPDATE'), 'service has no turn update privilege';
  assert not has_table_privilege('service_role', 'agent_chat.turns', 'DELETE'), 'service has no turn delete privilege';
  assert not has_table_privilege('service_role', 'agent_chat.turns', 'TRUNCATE'), 'service has no turn truncate privilege';
  assert has_table_privilege('agent_chat_committer', 'agent_chat.turns', 'INSERT'), 'committer holds the only application turn insert grant';
  foreach v_routine in array array[
    'agent_chat_api.submit_message(uuid,uuid,uuid,text,integer,integer,integer,integer,integer,integer,uuid)',
    'agent_chat_api.cancel_run(uuid,uuid)',
    'agent_chat_api.start_run(uuid,integer,integer)',
    'agent_chat_api.commit_step(uuid,integer,jsonb,boolean,jsonb)',
    'agent_chat_api.fail_run(uuid,jsonb)',
    'agent_chat_api.sweep_candidates(uuid,integer,integer,integer)'
  ] loop
    assert not has_function_privilege('anon', v_routine, 'EXECUTE'), format('anon cannot execute %s', v_routine);
    assert not has_function_privilege('authenticated', v_routine, 'EXECUTE'), format('authenticated cannot execute %s', v_routine);
  end loop;
  assert not has_function_privilege('anon', 'agent_chat_api.list_conversations(text,integer)', 'EXECUTE'), 'anonymous reads are forbidden';
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  result := agent_chat_api.list_conversations();
  assert result = '{"items":[]}', 'RLS hides another user conversations';
  result := agent_chat_api.read_conversation(conversation_id);
  assert result->>'kind' = 'not_found', 'RLS hides another user transcript';
  assert (select count(*) from account_api.get_profile()) = 0, 'RLS hides another user profile';
  reset role;
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  assert (select display_name from account_api.get_profile()) = 'Alice', 'the owner can read the persisted profile';
  result := agent_chat_api.read_conversation(conversation_id);
  assert jsonb_array_length(result#>'{exchanges,items}') = 1, 'the owner sees one exchange';
  assert jsonb_array_length(result#>'{exchanges,items,0,turns}') = 2, 'the owner sees committed tool and final turns';
  reset role;

  set local role service_role;
  receipt := agent_chat_api.submit_message(a, env_id, gen_random_uuid(), 'second', 8, 4, 60, 2, 10, 900, conversation_id);
  v_run_id := (receipt#>>'{run,id}')::uuid;
  result := agent_chat_api.start_run(v_run_id, 20, 524288);
  assert jsonb_array_length(result#>'{input,history}') = 1, 'completed history is loaded';
  result := agent_chat_api.start_run(v_run_id, 0, 524288);
  assert jsonb_array_length(result#>'{input,history}') = 0, 'history run bound is honored';
  result := agent_chat_api.start_run(v_run_id, 20, 1);
  assert jsonb_array_length(result#>'{input,history}') = 0, 'oversized history drops the oldest exchanges';
  result := agent_chat_api.cancel_run(a, v_run_id);
  assert result->>'state' = 'canceled', 'cancel transitions a running run';
  result := agent_chat_api.commit_step(v_run_id, 1, '[{"kind":"text","text":"too late"}]', true, '{"inputTokens":1,"outputTokens":1}');
  assert result->>'kind' = 'ended' and not exists (select from agent_chat.turns t where t.run_id = v_run_id), 'no turn follows cancellation';
  result := agent_chat_api.fail_run(v_run_id, '{"kind":"execution","code":"internal"}');
  assert result->>'state' = 'canceled', 'cancellation wins later failure';
  receipt := agent_chat_api.submit_message(a, env_id, gen_random_uuid(), 'third', 8, 4, 60, 2, 10, 900, conversation_id);
  v_run_id := (receipt#>>'{run,id}')::uuid;
  result := agent_chat_api.start_run(v_run_id, 20, 524288);
  assert jsonb_array_length(result#>'{input,history}') = 1, 'canceled runs are absent from model history';
  result := agent_chat_api.fail_run(v_run_id, '{"kind":"limit","limit":"context"}');
  assert result#>>'{failure,limit}' = 'context', 'failure is persisted';
  result := agent_chat_api.cancel_run(a, v_run_id);
  assert result->>'state' = 'failed', 'failure wins later cancellation';
  result := agent_chat_api.commit_step(v_run_id, 1, '[]', true, '{"inputTokens":1,"outputTokens":1}');
  assert result->>'kind' = 'ended', 'failure wins later completion';
  receipt := agent_chat_api.submit_message(a, env_id, gen_random_uuid(), 'fourth', 8, 4, 60, 2, 10, 900, conversation_id);
  v_run_id := (receipt#>>'{run,id}')::uuid;
  result := agent_chat_api.start_run(v_run_id, 20, 524288);
  assert jsonb_array_length(result#>'{input,history}') = 1, 'failed and canceled runs are absent from model history';
  perform agent_chat_api.commit_step(v_run_id, 1, '[{"kind":"text","text":"four"}]', true, '{"inputTokens":1,"outputTokens":1}');
  receipt := agent_chat_api.submit_message(a, env_id, gen_random_uuid(), 'fifth', 8, 4, 60, 2, 10, 900, conversation_id);
  v_run_id := (receipt#>>'{run,id}')::uuid;
  result := agent_chat_api.start_run(v_run_id, 1, 524288);
  assert jsonb_array_length(result#>'{input,history}') = 1 and result#>>'{input,history,0,run,message}' = 'fourth',
    'the run bound drops the oldest completed run';
  result := agent_chat_api.start_run(v_run_id, 20, 3 + (
    select octet_length(agent_chat.exchange_json(r)::text) from agent_chat.runs r where r.owner_id = a and r.message = 'fourth'));
  assert jsonb_array_length(result#>'{input,history}') = 1 and result#>>'{input,history,0,run,message}' = 'fourth',
    'the byte bound drops the oldest completed run';
  perform agent_chat_api.cancel_run(a, v_run_id);
  receipt := agent_chat_api.submit_message(a, env_id, gen_random_uuid(), 'deadline', 8, 4, 60, 2, 10, 900, null);
  v_run_id := (receipt#>>'{run,id}')::uuid;
  perform agent_chat_api.start_run(v_run_id, 20, 524288);
  update agent_chat.runs set deadline = now() - interval '1 second' where id = v_run_id;
  result := agent_chat_api.commit_step(v_run_id, 1, '[{"kind":"text","text":"late"}]', true, '{"inputTokens":1,"outputTokens":1}');
  assert result->>'kind' = 'ended' and (select failure->>'limit' from agent_chat.runs where id = v_run_id) = 'duration', 'deadline wins a late model commit';
  receipt := agent_chat_api.submit_message(a, env_id, gen_random_uuid(), 'sweep', 8, 4, 60, 2, 10, 900, null);
  v_run_id := (receipt#>>'{run,id}')::uuid;
  update agent_chat.runs set created_at = now() - interval '2 minutes' where id = v_run_id;
  result := agent_chat_api.sweep_candidates(env_id, 60, 300, 25);
  assert (result->'dispatch') ? v_run_id::text, 'sweep finds a lost dispatch';
  update agent_chat.runs set deadline = now() - interval '6 minutes' where id = v_run_id;
  result := agent_chat_api.sweep_candidates(env_id, 60, 300, 25);
  assert (result->'expired') ? v_run_id::text, 'sweep finds a run past the terminal grace';
  result := agent_chat_api.fail_run(v_run_id, '{"kind":"limit","limit":"model_retries"}');
  assert result#>>'{failure,limit}' = 'duration', 'database deadline takes priority over exhausted retries';
  reset role;
end;
$$;

select 'ok 1 - ownership, grants, idempotency, limits, history, deadlines and terminal transitions';
rollback;
