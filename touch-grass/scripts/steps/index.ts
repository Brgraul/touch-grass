import type { Step } from '../lib/engine.ts';
import { githubSteps } from './github.ts';
import { localSteps } from './local.ts';
import { codexSteps } from './codex.ts';
export const steps: Step[] = [...localSteps, ...githubSteps, ...codexSteps];
