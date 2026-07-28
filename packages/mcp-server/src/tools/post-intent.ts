import { z } from 'zod';
import { appendEvent } from '@ccx/storage';
import { getContext } from '../context.js';

export const postIntentInputShape = {
  parent_plan_id: z.string(),
  description: z.string().min(1).max(500),
  ordinal: z.number().int().min(0),
} as const;

export async function postIntent(args: {
  parent_plan_id: string;
  description: string;
  ordinal: number;
}): Promise<{ ok: true; event_id: string } | { ok: false; error: string }> {
  try {
    const ctx = await getContext();
    const ev = await appendEvent(ctx.client.db, {
      projectId: ctx.project.id,
      sessionId: ctx.session.id,
      type: 'Intent',
      payload: args,
    });
    return { ok: true, event_id: ev.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
