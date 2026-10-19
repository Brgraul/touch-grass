import type { Step } from '../lib/engine.ts';
import { githubSteps } from './github.ts';
import { localSteps, verificationSteps } from './local.ts';
export const steps: Step[] = [...localSteps, ...githubSteps, ...verificationSteps];
