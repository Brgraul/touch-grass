import type { Step } from '../lib/engine.ts';
import { localSteps, verificationSteps } from './local.ts';
import { repositorySteps } from './repository.ts';
export const steps: Step[] = [...localSteps, ...repositorySteps, ...verificationSteps];
