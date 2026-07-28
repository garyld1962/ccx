import { z } from 'zod';
import { appendEvent } from '@ccx/storage';
import { getContext } from '../context.js';

const verificationShape = z.object({
  commit_sha: z.string().nullable(),
  test_command: z.string().nullable(),
  test_exit_code: z.number().int().nullable(),
  evidence_note: z.string().max(200),
});

export const postIntentStatusInputShape = {
  intent_id: z.string(),
  status: z.enum(['started', 'completed', 'blocked', 'abandoned']),
  verification: verificationShape.optional(),
  reason: z.string().min(1).max(500).optional(),
} as const;

export async function postIntentStatus(args: {
  intent_id: string;
  status: 'started' | 'completed' | 'blocked' | 'abandoned';
  verification?: z.infer<typeof verificationShape>;
  reason?: string;
}): Promise<{ ok: true; event_id: string } | { ok: false; error: string }> {
  try {
    const ctx = await getContext();
    const ev = await appendEvent(ctx.client.db, {
      projectId: ctx.project.id,
      sessionId: ctx.session.id,
      type: 'IntentStatus',
      payload: args,
    });
    return { ok: true, event_id: ev.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
