import { eq, and, desc, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ulid } from 'ulid';
import { validatePayload, type EventType } from '@ccx/schema';
import * as schema from './schema.js';

export type EventRow = typeof schema.events.$inferSelect;

export interface AppendEventInput {
  projectId: string;
  sessionId: string;
  type: EventType;
  payload: unknown;
}

export async function appendEvent(
  db: PostgresJsDatabase<typeof schema>,
  input: AppendEventInput,
): Promise<EventRow> {
  const validated = validatePayload(input.type, input.payload);
  const id = ulid();
  const [row] = await db
    .insert(schema.events)
    .values({
      id,
      projectId: input.projectId,
      sessionId: input.sessionId,
      type: input.type,
      payload: validated as object,
    })
    .returning();
  if (!row) throw new Error('appendEvent failed');
  return row;
}

export interface QueryEventsInput {
  projectId: string;
  type?: EventType;
  sessionId?: string;
  limit?: number;
}

export async function queryEvents(
  db: PostgresJsDatabase<typeof schema>,
  input: QueryEventsInput,
): Promise<EventRow[]> {
  const conditions: SQL[] = [eq(schema.events.projectId, input.projectId)];
  if (input.type) conditions.push(eq(schema.events.type, input.type));
  if (input.sessionId) conditions.push(eq(schema.events.sessionId, input.sessionId));

  const q = db
    .select()
    .from(schema.events)
    .where(and(...conditions))
    .orderBy(desc(schema.events.createdAt));

  return input.limit !== undefined ? q.limit(input.limit) : q;
}
