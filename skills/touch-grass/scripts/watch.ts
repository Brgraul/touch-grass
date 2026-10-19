import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type Event, type ProgressStep, progressDir, type Status } from './lib/events.ts';
import { StepError } from './lib/exec.ts';
import { logo } from './lib/logo.ts';
import { deploySteps } from './lib/deploy.ts';
import { steps } from './steps/index.ts';

export type Phase = { title: string; steps: readonly ProgressStep[] };

export const phases: readonly Phase[] = [
  { title: 'Bootstrap', steps: steps.filter(step => step.group === 'provisioning') },
  { title: 'Verify', steps: steps.filter(step => step.group === 'verification') },
  { title: 'Deploy', steps: deploySteps },
];

/** `section` is the index in the step's `sections` of the last header its current run printed. */
type StepState = { status: Status; detail?: string; since?: number; durations: number[]; section?: number };

export type View = { steps: Map<string, StepState>; lines: { step: string; line: string }[] };

const sectionsOf = new Map(phases.flatMap(phase => phase.steps.flatMap(step => (step.sections ? [[step.id, step.sections] as const] : []))));

export const emptyView = (): View => ({ steps: new Map(), lines: [] });

/** Folds one event into the view. A running-to-done pair records a duration, which later replaces the step's guess. */
export function apply(view: View, event: Event): void {
  if ('line' in event) {
    view.lines.push({ step: event.step, line: event.line });
    if (view.lines.length > 200) view.lines.shift();
    const header = /^=== (.+) ===$/.exec(event.line)?.[1];
    const section = header === undefined ? -1 : sectionsOf.get(event.step)?.indexOf(header) ?? -1;
    const state = view.steps.get(event.step);
    if (state && section >= 0) state.section = section;
    return;
  }
  const state = view.steps.get(event.step) ?? { status: 'pending', durations: [] };
  const active = (status: Status) => status === 'running' || status === 'waiting';
  if (event.status === 'done' && active(state.status) && state.since !== undefined) state.durations.push((event.t - state.since) / 1000);
  const continuing = active(event.status) && active(state.status);
  view.steps.set(event.step, { status: event.status, detail: event.detail, since: active(event.status) ? (continuing ? state.since : event.t) : undefined, durations: state.durations, section: continuing || event.status === 'failed' ? state.section : undefined });
}

const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function estimate(view: View, step: ProgressStep): number {
  const durations = view.steps.get(step.id)?.durations ?? [];
  return durations.length ? median(durations)! : step.seconds;
}

const finished = (status: Status) => status === 'done' || status === 'skipped';

/** Seconds of work behind and ahead in a phase. An overrunning step counts as nearly done, never as complete. */
function measure(view: View, phase: Phase, now: number): { spent: number; left: number } {
  let spent = 0, left = 0;
  for (const step of phase.steps) {
    const state = view.steps.get(step.id);
    const seconds = estimate(view, step);
    if (state && finished(state.status)) spent += seconds;
    else if (state?.status === 'failed' && step.sections && state.section !== undefined) {
      const share = state.section / step.sections.length;
      spent += seconds * share;
      left += seconds * (1 - share);
    } else if (state?.since !== undefined) {
      const elapsed = (now - state.since) / 1000;
      // A step that reports sections has done the ones before its current header, so the bar follows its real progress.
      const share = step.sections && state.section !== undefined ? state.section / step.sections.length : Math.min(elapsed / seconds, 0.95);
      spent += seconds * share;
      left += Math.max(seconds * (1 - share), seconds * 0.05);
    } else left += seconds;
  }
  return { spent, left };
}

export type Color = false | 'ansi256' | 'truecolor';

const channels = (hex: string) => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** The nearest color in xterm's 6x6x6 cube, or its gray ramp for colors with almost no hue. */
function ansi256([r, g, b]: [number, number, number]): number {
  if (Math.max(r, g, b) - Math.min(r, g, b) < 16) return 232 + Math.min(23, Math.max(0, Math.round(((r + g + b) / 3 - 8) / 10)));
  const steps = [0, 95, 135, 175, 215, 255];
  const level = (value: number) => steps.reduce((best, step, index) => Math.abs(step - value) < Math.abs(steps[best]! - value) ? index : best, 0);
  return 16 + 36 * level(r) + 6 * level(g) + level(b);
}

/** The logo as half-block cells: the upper pixel is the glyph's color and the lower one its background. */
function logoRows(color: Exclude<Color, false>): string[] {
  const code = (layer: 38 | 48, hex: string) => color === 'truecolor' ? `${layer};2;${channels(hex).join(';')}` : `${layer};5;${ansi256(channels(hex))}`;
  const pixel = (row: string, x: number) => { const hex = row.slice(x * 6, x * 6 + 6); return hex === '......' ? undefined : hex; };
  const rows: string[] = [];
  for (let y = 0; y < logo.length; y += 2) {
    let line = '';
    for (let x = 0; x < logo[y]!.length / 6; x++) {
      const top = pixel(logo[y]!, x), bottom = pixel(logo[y + 1] ?? '', x);
      line += top && bottom ? `\x1b[${code(38, top)};${code(48, bottom)}m▀\x1b[0m`
        : top ? `\x1b[${code(38, top)}m▀\x1b[0m`
        : bottom ? `\x1b[${code(38, bottom)}m▄\x1b[0m`
        : ' ';
    }
    rows.push(line);
  }
  return rows;
}

const logoWidth = logo[0]!.length / 6;

const tagline = ['Ready for high-leverage prompting,', 'from your desk or the great outdoors! ☀️'];

/** The closing screen: the logo when the terminal has room for it, the tagline, and what each step took. */
function finale(view: View, width: number, height: number, color: Color, paint: (code: string, text: string) => string): string {
  const centered = (text: string, length = text.length) => ' '.repeat(Math.max(0, Math.floor((width - length) / 2))) + text;
  const clip = (text: string) => text.length > width ? text.slice(0, width - 1) + '…' : text;
  const lines = [''];
  if (color && width > logoWidth && height >= logo.length / 2 + 8) {
    for (const row of logoRows(color)) lines.push(centered(row, logoWidth));
    lines.push('');
  }
  const joined = tagline.join(' ');
  lines.push(...(joined.length < width ? [joined] : tagline).map(row => paint('1', centered(clip(row)))), '');
  const took = phases.map(phase => {
    const seconds = phase.steps.reduce((sum, step) => sum + (view.steps.get(step.id)?.durations.at(-1) ?? 0), 0);
    return `✓ ${phase.title}${seconds ? ` ${clock(seconds)}` : ''}`;
  }).join('   ');
  lines.push(paint('32', centered(clip(took))));
  const url = view.steps.get('deploy')?.detail;
  if (url?.startsWith('https://')) lines.push('', paint('1;36', centered(clip(`Live at ${url}`))));
  return lines.join('\n');
}

const clock = (seconds: number) => seconds < 60 ? `${Math.round(seconds)}s` : `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
const eta = (seconds: number) => seconds < 60 ? '<1m' : `~${Math.ceil(seconds / 60)}m`;
const marks: Record<Status, string> = { pending: '○', running: '●', waiting: '→', done: '✓', skipped: '–', failed: '✗' };
const tones: Record<Status, string> = { pending: '2', running: '36', waiting: '33', done: '32', skipped: '2', failed: '31' };

/** One screen of the dashboard. Plain text when `color` is false. */
export function frame(view: View, now: number, width: number, height: number, color: Color): string {
  const paint = (code: string, text: string) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
  const fit = (text: string) => text.length > width ? text.slice(0, Math.max(0, width - 1)) + '…' : text;
  const statusOf = (step: ProgressStep) => view.steps.get(step.id)?.status ?? 'pending';
  const phaseStatus = (phase: Phase): Status =>
    phase.steps.some(step => statusOf(step) === 'failed') ? 'failed'
    : phase.steps.every(step => finished(statusOf(step))) ? 'done'
    : phase.steps.some(step => statusOf(step) === 'waiting') ? 'waiting'
    : phase.steps.some(step => statusOf(step) !== 'pending') ? 'running'
    : 'pending';
  const current = phases.findIndex(phase => phaseStatus(phase) !== 'done');
  if (current < 0) return finale(view, width, height, color, paint);
  const left = phases.slice(current).reduce((sum, phase) => sum + measure(view, phase, now).left, 0);
  const stopped = phaseStatus(phases[current]!) === 'failed';
  const headline = `step ${current + 1} of 3  ${phases[current]!.title}  ${stopped ? 'stopped until the failure below is fixed' : `${eta(left)} left overall`}`;
  const lines = [paint('1', fit(`touch-grass  ${headline}`)), ''];

  phases.forEach((phase, index) => {
    const status = phaseStatus(phase);
    const label = `${marks[status]} ${index + 1} ${phase.title.padEnd(10)}`;
    const { spent, left } = measure(view, phase, now);
    const needs = phase.steps.filter(step => step.person && !finished(statusOf(step))).map(step => step.title);
    if (index !== current) {
      const note = status === 'done' ? 'done' : `${eta(left)}${needs.length ? `  needs you: ${needs.join(', ')}` : '  runs on its own'}`;
      lines.push(paint(tones[status], fit(`${label}${note}`)));
      return;
    }
    const share = spent / (spent + left || 1);
    const bar = '▓'.repeat(Math.round(share * 20)).padEnd(20, '░');
    lines.push(paint(tones[status], fit(`${label}${bar} ${String(Math.round(share * 100)).padStart(3)}%  ${stopped ? 'failed' : `${eta(left)} left`}`)));
    for (const step of phase.steps) {
      const state = view.steps.get(step.id);
      const stepStatus = state?.status ?? 'pending';
      const elapsed = state?.since !== undefined ? `  ${clock((now - state.since) / 1000)}` : '';
      const section = step.sections && state?.section !== undefined ? `  ${state.section + 1} of ${step.sections.length}: ${step.sections[state.section]}` : '';
      lines.push(paint(tones[stepStatus], fit(`    ${marks[stepStatus]} ${step.title}${elapsed}${section}`)));
      if (stepStatus === 'waiting') lines.push(paint('1;33', fit(`        your turn: ${state?.detail ?? step.person ?? 'see the agent'}`)));
      else if (stepStatus === 'failed' && state?.detail) lines.push(paint('31', fit(`        ${state.detail}`)));
      else if (stepStatus === 'running' && step.person) lines.push(paint('2', fit(`        may need you to ${step.person}`)));
    }
  });

  const room = Math.min(12, height - lines.length - 3);
  const shown = view.lines.filter(entry => phases[current]!.steps.some(step => step.id === entry.step));
  if (room > 0 && shown.length) {
    lines.push('', paint('2', fit(`── output ${'─'.repeat(Math.max(0, width - 10))}`)));
    for (const entry of shown.slice(-room)) lines.push(paint('2', fit(entry.line)));
  }
  return lines.join('\n');
}

/** Follows the progress log until interrupted: a redrawn dashboard on a terminal, one line per event otherwise. */
export async function watch(root: string): Promise<number> {
  const dir = progressDir(root);
  if (!dir) throw new StepError('tg watch needs the repository Touch Grass is setting up. Run it from that repository root.');
  const file = join(dir, 'events.jsonl');
  const tty = process.stdout.isTTY;
  const color: Color = /truecolor|24bit/i.test(process.env.COLORTERM ?? '') ? 'truecolor' : 'ansi256';
  let view = emptyView(), offset = 0, rest = '';

  const read = () => {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size < offset) { view = emptyView(); offset = 0; rest = ''; }
    if (size === offset) return;
    const buffer = Buffer.alloc(size - offset);
    const fd = openSync(file, 'r');
    try { readSync(fd, buffer, 0, buffer.length, offset); } finally { closeSync(fd); }
    offset = size;
    const lines = (rest + buffer.toString('utf8')).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) {
      let event: Event;
      try { event = JSON.parse(line); } catch { continue; }
      apply(view, event);
      if (!tty) process.stdout.write('line' in event ? `  ${event.line}\n` : `${marks[event.status]} ${event.step} ${event.status}${event.detail ? `: ${event.detail}` : ''}\n`);
    }
  };

  if (!tty) {
    for (;;) { read(); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  // Autowrap off: a glyph the terminal draws two columns wide must clip, not wrap and shift every line below it.
  const restore = () => process.stdout.write('\x1b[?7h\x1b[?25h\x1b[?1049l');
  process.on('exit', restore);
  process.on('SIGINT', () => process.exit(0));
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?7l');
  for (;;) {
    read();
    const screen = frame(view, Date.now(), (process.stdout.columns ?? 80) - 1, process.stdout.rows ?? 24, color);
    process.stdout.write('\x1b[H' + screen.split('\n').map(line => line + '\x1b[K').join('\n') + '\x1b[J');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
