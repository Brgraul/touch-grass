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
