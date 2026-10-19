import { emit, type Status } from './events.ts';
import { StepError } from './exec.ts';
import type { Project } from './project.ts';

export type Observation = { done: true; summary: string } | { done: false; summary?: string };

export const groups = ['provisioning', 'deployment', 'verification'] as const;

export type Group = (typeof groups)[number];

/** The command whose run applies a group's script steps. */
export const commands: Record<Group, string> = { provisioning: 'tg run', verification: 'tg verify', deployment: 'tg staging' };

type StepBase = {
  id: string;
  group: Group;
  title: string;
  /** First-run estimate for `tg watch`. */
  seconds: number;
  /** Output section headers, in order, that `tg watch` counts as progress. */
  sections?: readonly string[];
  needs: readonly string[];
  observe(project: Project): Promise<Observation>;
};

export type ScriptStep = StepBase & { actor: 'script'; apply(project: Project): Promise<void> };

export type HandStep = StepBase & { actor: 'agent' | 'person'; instructions(project: Project): string };

export type Step = ScriptStep | HandStep;

export type Outcome = { id: string; group: Group; title: string } & (
  | { state: 'done'; summary: string }
  | { state: 'ready'; summary?: string }
  | { state: 'waiting'; actor: 'agent' | 'person'; instructions: string; summary?: string }
  | { state: 'blocked'; on: readonly string[] }
  | { state: 'failed'; reason: string }
);

function failure(error: unknown): string {
  if (error instanceof StepError) return error.message;

  return 'Operation failed. Inspect local state privately before retrying.';
}

/** Observes every step and applies ready script steps only in the `apply` groups. The rest report `ready` for their own command. */
export async function evaluate(steps: readonly Step[], project: Project, apply: readonly Group[]): Promise<Outcome[]> {
  validateSteps(steps);
  const outcomes = new Map<string, Outcome>();
  const settle = (outcome: Outcome) => {
    outcomes.set(outcome.id, outcome);
    // `tg status` writes nothing. Other commands report their own groups, and a step done elsewhere, such as in a clone generated earlier.
    if (apply.length > 0 && (apply.includes(outcome.group) || outcome.state === 'done')) emit(project.root, { step: outcome.id, ...progress(outcome) });
  };

  for (const step of steps) {
    const base = { id: step.id, group: step.group, title: step.title };
    const unmet = step.needs.filter(need => outcomes.get(need)?.state !== 'done');

    if (unmet.length > 0) {
      settle({ ...base, state: 'blocked', on: unmet });
      continue;
    }

    try {
      const seen = await step.observe(project);

      if (seen.done) settle({ ...base, state: 'done', summary: seen.summary });
      else if (step.actor !== 'script') settle({ ...base, state: 'waiting', actor: step.actor, instructions: step.instructions(project), summary: seen.summary });
      else if (!apply.includes(step.group)) settle({ ...base, state: 'ready', summary: seen.summary });
      else {
        process.stderr.write(`tg: ${step.id}: ${step.title}\n`);
        emit(project.root, { step: step.id, status: 'running' });
        await step.apply(project);
        const after = await step.observe(project);

        if (!after.done) throw new StepError(`${step.id} ran but its goal state is still missing${after.summary ? `: ${after.summary}` : ''}.`);
        settle({ ...base, state: 'done', summary: after.summary });
      }
    } catch (error) {
      settle({ ...base, state: 'failed', reason: failure(error) });
    }
  }

  return [...outcomes.values()];
}

function progress(outcome: Outcome): { status: Status; detail?: string } {
  switch (outcome.state) {
    case 'done': return { status: 'done', detail: outcome.summary };
    case 'waiting': return { status: 'waiting', detail: outcome.summary ?? outcome.instructions };
    case 'failed': return { status: 'failed', detail: outcome.reason };
    default: return { status: 'pending' };
  }
}

const marks = { done: '✓', ready: '○', waiting: '→', blocked: '·', failed: '✗' } as const;

export function render(project: Project, outcomes: readonly Outcome[]): string {
  const ready = [...new Set(outcomes.flatMap(outcome => (outcome.state === 'ready' ? [commands[outcome.group]] : [])))];
  const width = Math.max(0, ...outcomes.map(outcome => outcome.id.length));
  const lines = [`touch-grass: ${project.root}`];

  for (const group of groups) {
    const members = outcomes.filter(outcome => outcome.group === group);

    if (members.length === 0) { lines.push(`${group}: ${group === 'deployment' ? 'not configured' : 'pending'}`); continue; }
    const done = members.filter(outcome => outcome.state === 'done').length;
    lines.push(`${group}: ${done === members.length ? 'complete' : `${done} of ${members.length} steps done`}`);

    for (const outcome of members) {
      const detail =
        outcome.state === 'done' ? outcome.summary
        : outcome.state === 'ready' ? `ready for \`${commands[outcome.group]}\`${outcome.summary ? `: ${outcome.summary}` : ''}`
        : outcome.state === 'waiting' ? `waiting on the ${outcome.actor}${outcome.summary ? `: ${outcome.summary}` : ''}`
        : outcome.state === 'blocked' ? `needs ${outcome.on.join(', ')}`
        : outcome.reason;
      lines.push(`  ${marks[outcome.state]} ${outcome.id.padEnd(width)}  ${outcome.title}. ${detail}`);
    }
  }

  const failed = outcomes.filter(outcome => outcome.state === 'failed');
  const waiting = outcomes.filter(outcome => outcome.state === 'waiting');

  for (const outcome of waiting) {
    if (outcome.state === 'waiting') lines.push('', `Next, ${outcome.id} (${outcome.actor}):`, outcome.instructions.trim());
  }

  if (failed.length > 0) lines.push('', `Failed: ${failed.map(outcome => outcome.id).join(', ')}. Fix the cause named above, then run \`${commands[failed[0]!.group]}\` again.`);
  else if (waiting.length === 0 && ready.length > 0) lines.push('', `Run \`${ready[0]}\`.`);
  else if (outcomes.length > 0 && outcomes.every(outcome => outcome.state === 'done')) lines.push('', 'All steps are complete.');

  return lines.join('\n');
}

/** 0 once every step of every `required` group is done, 1 on any failure, 2 while incomplete. */
export function exitCode(outcomes: readonly Outcome[], required: readonly Group[]): number {
  if (outcomes.some(outcome => outcome.state === 'failed')) return 1;

  return required.every(group => outcomes.some(outcome => outcome.group === group)) && outcomes.filter(outcome => required.includes(outcome.group)).every(outcome => outcome.state === 'done') ? 0 : 2;
}

export function validateSteps(steps: readonly Step[]): void {
  const seen = new Set<string>();
  for (const step of steps) {
    if (!step.id || seen.has(step.id) || step.needs.some(id => !seen.has(id))) throw new StepError('Step registry has duplicate IDs or dependencies out of order.');
    seen.add(step.id);
  }
}
export function report(outcomes: readonly Outcome[]) {
  function state(group: Group): string {
    const members = outcomes.filter(o => o.group === group);
    if (!members.length) return group === 'deployment' ? 'not configured' : 'pending';
    return members.some(o => o.state === 'failed') ? 'failed' : members.every(o => o.state === 'done') ? 'complete' : 'pending';
  }
  return { provisioning: state('provisioning'), verification: state('verification'), deployment: state('deployment'), outcomes };
}
