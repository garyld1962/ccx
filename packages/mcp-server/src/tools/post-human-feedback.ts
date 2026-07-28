import { z } from 'zod';
import { appendEvent } from '@ccx/storage';
import { getContext } from '../context.js';

export const postHumanFeedbackInputShape = {
  verbatim: z.string().min(1).max(2000),
  interpreted_as: z.string().min(1).max(500),
} as const;

export async function postHumanFeedback(args: {
  verbatim: string;
  interpreted_as: string;
}): Promise<{ ok: true; event_id: string } | { ok: false; error: string }> {
  try {
    const ctx = await getContext();
    const ev = await appendEvent(ctx.client.db, {
      projectId: ctx.project.id,
      sessionId: ctx.session.id,
      type: 'HumanFeedback',
      payload: {
        verbatim: args.verbatim,
        interpreted_as: args.interpreted_as,
      },
    });
    return { ok: true, event_id: ev.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
