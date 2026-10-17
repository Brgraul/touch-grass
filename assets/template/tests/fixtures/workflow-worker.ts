export { AgentChatWorkflow } from '../../src/features/agent-chat/agent-chat.workflow.server';

export default { fetch: () => new Response('Workflow test worker', { status: 404 }) };
