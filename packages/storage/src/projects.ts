import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type ProjectRow = typeof schema.projects.$inferSelect;

export async function ensureProject(
  db: PostgresJsDatabase<typeof schema>,
  input: { id: string; name: string },
): Promise<ProjectRow> {
  await db
    .insert(schema.projects)
    .values({ id: input.id, name: input.name })
    .onConflictDoNothing();
  const got = await getProject(db, input.id);
  if (!got) throw new Error(`failed to ensure project ${input.id}`);
  return got;
}

export async function getProject(
  db: PostgresJsDatabase<typeof schema>,
  id: string,
): Promise<ProjectRow | null> {
  const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
  return row ?? null;
}

export async function listProjects(
  db: PostgresJsDatabase<typeof schema>,
): Promise<ProjectRow[]> {
  return db.select().from(schema.projects).orderBy(schema.projects.name);
}
