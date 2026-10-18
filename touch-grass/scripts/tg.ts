import { parseArgs } from 'node:util';
import { evaluate, exitCode, render, report } from './lib/engine.ts';
import { StepError } from './lib/exec.ts';
import { findProjectRoot, Project } from './lib/project.ts';
import { route } from './lib/routing.ts';
import { steps } from './steps/index.ts';
const usage = `Usage: tg <route|status|run> [--json]
  route   Select unfinished bootstrap or repository verification without writes.
  status  Observe local provisioning without writes.
  run     Converge safe script steps and report agent handoffs.
route exits 0 after selecting a workflow; it does not verify the project.
For status/run, 2 means incomplete and 1 means failure.
Cloud observations remain in supported task/UI output, never a local pass marker.`;
try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) { process.stdout.write(usage + '\n'); }
  else {
    if (positionals.length === 1 && positionals[0] === 'route') {
      const selected = route(findProjectRoot());
      process.stdout.write((values.json ? JSON.stringify(selected) : selected.kind === 'verify' ? `verify ${selected.skill}` : `bootstrap ${selected.reason}`) + '\n');
    } else {
      if (positionals.length !== 1 || (positionals[0] !== 'status' && positionals[0] !== 'run')) throw new StepError(usage);
      const project = new Project(findProjectRoot());
      const outcomes = await evaluate(steps, project, positionals[0]);
      process.stdout.write((values.json ? JSON.stringify(report(outcomes), null, 2) : render(project, outcomes)) + '\n');
      process.exitCode = exitCode(outcomes);
    }
  }
} catch (error) {
  process.stderr.write(`tg: ${error instanceof StepError ? error.message : 'Operation failed. Inspect local state privately before retrying.'}\n`);
  process.exitCode = 1;
}
