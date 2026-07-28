import { z } from 'zod';
import { appendEvent } from '@ccx/storage';
import { getContext } from '../context.js';

export const postPlanInputShape = {
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(2000),
  supersedes: z.string().nullable().optional(),
} as const;

export async function postPlan(args: {
  title: string;
  summary: string;
  supersedes?: string | null;
}): Promise<{ ok: true; event_id: string } | { ok: false; error: string }> {
  try {
    const ctx = await getContext();
    const ev = await appendEvent(ctx.client.db, {
      projectId: ctx.project.id,
      sessionId: ctx.session.id,
      type: 'Plan',
      payload: {
        title: args.title,
        summary: args.summary,
        supersedes: args.supersedes ?? null,
      },
    });
    return { ok: true, event_id: ev.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
