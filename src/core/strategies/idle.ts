/**
 * The null strategy: every fielder stays on the idle policy and never sends a message.
 * It exists so the decision loop has something to call before real strategies arrive, and it
 * doubles as a control in experiments.
 */
import type { AgentMemory, Decision, LocalView } from '../agents/types';
import type { Strategy } from './types';

export const idleStrategy: Strategy = {
  name: 'idle',
  initMemory(_selfId: number): AgentMemory {
    return { strategy: 'idle' };
  },
  decide(_view: LocalView): Decision {
    return { target: null, targetBallId: null, outbox: [] };
  },
};
