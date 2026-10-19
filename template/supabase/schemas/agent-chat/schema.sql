create schema agent_chat;
create schema agent_chat_api;
do $$ begin
  if not exists (select from pg_roles where rolname = 'agent_chat_committer') then
    create role agent_chat_committer nologin noinherit;
  end if;
end $$;
grant agent_chat_committer to postgres;
