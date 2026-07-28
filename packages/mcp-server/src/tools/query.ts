import { z } from 'zod';
import { queryEvents, type EventRow } from '@ccx/storage';
import { EventTypeSchema } from '@ccx/schema';
import { getContext } from '../context.js';

export const queryInputShape = {
  type: EventTypeSchema.optional(),
  session_id: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
} as const;

export async function query(args: {
  type?: import('@ccx/schema').EventType;
  session_id?: string;
  limit?: number;
}): Promise<
  | { ok: true; events: Array<Pick<EventRow, 'id' | 'type' | 'payload'> & { created_at: string }> }
  | { ok: false; error: string }
> {
  try {
    const ctx = await getContext();
    const rows = await queryEvents(ctx.client.db, {
      projectId: ctx.project.id,
      type: args.type,
      sessionId: args.session_id,
      limit: args.limit ?? 50,
    });
    return {
      ok: true,
      events: rows.map((r) => ({
        id: r.id,
        type: r.type,
        payload: r.payload,
        created_at: r.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
