import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { z } from 'zod';

const hookInput = z.object({ tool_input: z.object({ file_path: z.string() }) });

const checkedPath = /^(?:src|tests|tools)\/.+\.tsx?$/;

function editedPath(): string | undefined {
  try {
    const input = hookInput.parse(JSON.parse(readFileSync(0, 'utf8')));

    return relative(process.cwd(), resolve(input.tool_input.file_path)).split('\\').join('/');
  } catch {
    return undefined;
  }
}

function run(command: readonly string[]): string {
  const [file, ...args] = command;
  const result = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

  return result.status === 0 ? '' : `${result.stdout}${result.stderr}`.trim();
}

const path = editedPath();

if (path && checkedPath.test(path)) {
  const findings = [
    run(['pnpm', 'exec', 'oxlint', path]),
    path.startsWith('src/') ? run(['pnpm', 'exec', 'depcruise', '--config', 'dependency-cruiser.config.cjs', '--output-type', 'err-long', path]) : '',
  ].filter(Boolean);

  if (findings.length > 0) {
    process.stderr.write(`Fast checks found problems in ${path}. Fix them before you report completion.\n\n${findings.join('\n\n')}\n`);
    process.exitCode = 2;
  }
}
