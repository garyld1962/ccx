import { z } from 'zod';
import { appendEvent } from '@ccx/storage';
import { UlidSchema } from '@ccx/schema';
import { getContext } from '../context.js';

export const postDecisionInputShape = {
  decision: z.string().min(1).max(300),
  rationale: z.string().min(1).max(1000),
  alternatives_considered: z.array(z.string().min(1)).optional(),
  parent_plan_id: UlidSchema.nullable().optional(),
} as const;

export async function postDecision(args: {
  decision: string;
  rationale: string;
  alternatives_considered?: string[];
  parent_plan_id?: string | null;
}): Promise<{ ok: true; event_id: string } | { ok: false; error: string }> {
  try {
    const ctx = await getContext();
    const ev = await appendEvent(ctx.client.db, {
      projectId: ctx.project.id,
      sessionId: ctx.session.id,
      type: 'Decision',
      payload: {
        decision: args.decision,
        rationale: args.rationale,
        alternatives_considered: args.alternatives_considered ?? [],
        parent_plan_id: args.parent_plan_id ?? null,
      },
    });
    return { ok: true, event_id: ev.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
