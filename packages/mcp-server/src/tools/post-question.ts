import { z } from 'zod';
import { appendEvent } from '@ccx/storage';
import { UlidSchema } from '@ccx/schema';
import { getContext } from '../context.js';

export const postQuestionInputShape = {
  question: z.string().min(1).max(500),
  blocks_intent_id: UlidSchema.nullable().optional(),
  options_considered: z.array(z.string().min(1)).optional(),
} as const;

export async function postQuestion(args: {
  question: string;
  blocks_intent_id?: string | null;
  options_considered?: string[];
}): Promise<{ ok: true; event_id: string } | { ok: false; error: string }> {
  try {
    const ctx = await getContext();
    const ev = await appendEvent(ctx.client.db, {
      projectId: ctx.project.id,
      sessionId: ctx.session.id,
      type: 'Question',
      payload: {
        question: args.question,
        blocks_intent_id: args.blocks_intent_id ?? null,
        options_considered: args.options_considered ?? [],
      },
    });
    return { ok: true, event_id: ev.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
