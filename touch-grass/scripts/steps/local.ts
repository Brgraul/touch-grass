import type { Step } from '../lib/engine.ts';
import { run } from '../lib/exec.ts';
export const localSteps: Step[] = [{
  id: 'tools', group: 'provisioning', title: 'Local tools', needs: [], actor: 'agent',
  async observe() {
    const missing = ['git', 'gh'].filter(tool => run(tool, ['--version']).status !== 0);
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 23)) missing.push('Node >=22.23');
    return missing.length ? { done: false, summary: `missing ${missing.join(', ')}` } : { done: true, summary: 'Node >=22.23, git and gh available' };
  },
  instructions: () => 'Install missing Git/GitHub CLI/Node using the supported package manager, then rerun. Docker and Chrome are needed later for local verification, not to scaffold.',
}];
export const verificationSteps: Step[] = [{
  id: 'local-verification', group: 'verification', title: 'Four repository checks on this machine', needs: ['github-repo'], actor: 'agent',
  async observe() { return { done: false, summary: 'Run the repository-local touch-grass skill and record its four results in the conversation.' }; },
  instructions: () => 'Read and execute .agents/skills/touch-grass/SKILL.md in this repository. Install Docker and Google Chrome first if `pnpm check` needs them. All four checks must report passed at the current HEAD; exit 2 or a missing tool is incomplete, not a pass.',
}];
