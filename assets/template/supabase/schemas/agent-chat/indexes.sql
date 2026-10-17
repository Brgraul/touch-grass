create index conversations_owner_recent on agent_chat.conversations(owner_id, updated_at desc, id desc);
create index runs_conversation_recent on agent_chat.runs(conversation_id, created_at desc, id desc);
create index runs_owner_recent on agent_chat.runs(owner_id, created_at);
create index runs_environment_active on agent_chat.runs(environment_id) where state in ('queued', 'running');
create index turns_owner on agent_chat.turns(owner_id);
