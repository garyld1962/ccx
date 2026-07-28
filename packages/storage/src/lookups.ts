import { eq, and, desc, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import type { EventRow } from './events.js';

export async function latestPlanId(
  db: PostgresJsDatabase<typeof schema>,
  projectId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'Plan')))
    .orderBy(desc(schema.events.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function findIntentByCcTaskId(
  db: PostgresJsDatabase<typeof schema>,
  projectId: string,
  ccTaskId: string,
): Promise<EventRow | null> {
  const [row] = await db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.projectId, projectId),
        eq(schema.events.type, 'Intent'),
        sql`${schema.events.payload}->>'cc_task_id' = ${ccTaskId}`,
      ),
    )
    .orderBy(desc(schema.events.createdAt))
    .limit(1);
  return row ?? null;
}

export async function hasSessionArtifact(
  db: PostgresJsDatabase<typeof schema>,
  sessionId: string,
  path: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.sessionId, sessionId),
        eq(schema.events.type, 'Artifact'),
        sql`${schema.events.payload}->>'path' = ${path}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}
