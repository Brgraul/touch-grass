import { parseArgs } from 'node:util';
import { evaluate, exitCode, render, report, type Group } from './lib/engine.ts';
import { StepError } from './lib/exec.ts';
import { findProjectRoot, Project } from './lib/project.ts';
import { deploy } from './deploy.ts';
import { steps } from './steps/index.ts';
import { watch } from './watch.ts';
const usage = `Usage: tg <status|run|verify> [--json] | tg watch | tg deploy <command> (see tg deploy --help)
  status  Observe provisioning and local verification without writes.
  run     Converge provisioning: scaffold and push. A repository generated earlier needs no provisioning.
  verify  Run the repository's pnpm verify and record a pass only for the clean HEAD it tested. Needs provisioning complete.
  watch   Show live progress of the three setup steps. For the person, in a terminal they can see. Runs until interrupted.
Exit 0 means the command's goal is complete, 2 means incomplete and 1 means failure.`;
// What each command may apply, and which groups must be done for it to exit 0.
const modes: Record<string, { apply: readonly Group[]; required: readonly Group[] }> = {
  status: { apply: [], required: ['provisioning', 'verification'] },
  run: { apply: ['provisioning'], required: ['provisioning'] },
  verify: { apply: ['verification'], required: ['provisioning', 'verification'] },
};
try {
  if (process.argv[2] === 'deploy') process.exitCode = await deploy(process.argv.slice(3));
  else if (process.argv[2] === 'watch') process.exitCode = await watch(findProjectRoot());
  else {
    const { positionals, values } = parseArgs({ allowPositionals: true, options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
    const [command = ''] = positionals;
    const mode = positionals.length === 1 && Object.hasOwn(modes, command) ? modes[command] : undefined;
    if (values.help) { process.stdout.write(usage + '\n'); }
    else {
      if (!mode) throw new StepError(usage);
      const project = new Project(findProjectRoot());
      const outcomes = await evaluate(steps, project, mode.apply);
      process.stdout.write((values.json ? JSON.stringify(report(outcomes), null, 2) : render(project, outcomes)) + '\n');
      process.exitCode = exitCode(outcomes, mode.required);
    }
  }
} catch (error) {
  process.stderr.write(`tg: ${error instanceof StepError ? error.message : 'Operation failed. Inspect local state privately before retrying.'}\n`);
  process.exitCode = 1;
}
