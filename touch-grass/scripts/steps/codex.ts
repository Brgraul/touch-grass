import type { Step } from '../lib/engine.ts';
export const codexSteps: Step[] = [
  { id: 'codex-cloud', group: 'provisioning', title: 'Codex Cloud setup', needs: ['github-repo'], actor: 'agent',
    async observe() { return { done: false, summary: 'Native environment setup requires supported tool/UI observation; local files cannot attest it.' }; },
    instructions: () => 'Read this installed skill’s references/cloud.md. Use Settings > Codex Cloud > Environments, the setup conversation, install script/start skill and Publish. Automate supported UI up to person-only authorization. Record the observed environment and repository in the conversation.',
  },
  { id: 'cloud-verification', group: 'verification', title: 'Four checks in Codex Cloud', needs: ['github-repo'], actor: 'agent',
    async observe() { return { done: false, summary: 'Await observed cloud task results tied to repository, commit and selected environment.' }; },
    instructions: () => 'Run the repository-local $touch-grass in the selected cloud environment. Inspect the task output and actual revision. All four checks must pass. A local file, supplied environment ID, submitted task or exit 2 is not evidence of success.',
  },
];
