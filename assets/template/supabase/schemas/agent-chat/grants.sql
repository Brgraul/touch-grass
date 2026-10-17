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
