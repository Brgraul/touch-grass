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
  instructions: () => 'Install missing Git/GitHub CLI/Node using the supported package manager, then rerun. Local pnpm, Docker and Chrome are not required to scaffold.',
}];
