import { eq, isNull, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ulid } from 'ulid';
import * as schema from './schema.js';
import { ensureProject } from './projects.js';

export type SessionRow = typeof schema.sessions.$inferSelect;

export async function createSession(
  db: PostgresJsDatabase<typeof schema>,
  input: { projectId: string; host: string },
): Promise<SessionRow> {
  const id = ulid();
  const [row] = await db
    .insert(schema.sessions)
    .values({ id, projectId: input.projectId, host: input.host })
    .returning();
  if (!row) throw new Error('createSession failed');
  return row;
}

export async function endSession(
  db: PostgresJsDatabase<typeof schema>,
  id: string,
): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ endedAt: new Date() })
    .where(and(eq(schema.sessions.id, id), isNull(schema.sessions.endedAt)));
}

export async function getSession(
  db: PostgresJsDatabase<typeof schema>,
  id: string,
): Promise<SessionRow | null> {
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
  return row ?? null;
}

export async function ensureSessionForCc(
  db: PostgresJsDatabase<typeof schema>,
  input: { projectId: string; projectName: string; host: string; ccSessionId: string },
): Promise<SessionRow> {
  // The row is keyed by cc_session_id alone: if a CC session changes cwd into
  // a different ccx project mid-session, this reuses the first project's
  // session row rather than creating a new one for the new project. Accepted
  // for Phase 1; revisit in Phase 2.
  await ensureProject(db, { id: input.projectId, name: input.projectName });

  const [existing] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.ccSessionId, input.ccSessionId))
    .limit(1);
  if (existing) return existing;

  // Concurrent hooks may race; the unique index makes the loser a no-op.
  await db
    .insert(schema.sessions)
    .values({
      id: ulid(),
      projectId: input.projectId,
      host: input.host,
      ccSessionId: input.ccSessionId,
    })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.ccSessionId, input.ccSessionId))
    .limit(1);
  if (!row) throw new Error('ensureSessionForCc failed');
  return row;
}
