import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as path from 'node:path';
import * as schema from '../../src/schema.js';

let container: StartedPostgreSqlContainer | null = null;
let sql: ReturnType<typeof postgres> | null = null;
let db: PostgresJsDatabase<typeof schema> | null = null;

export async function setupTestDb(): Promise<PostgresJsDatabase<typeof schema>> {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();
  sql = postgres(url, { max: 5 });
  db = drizzle(sql, { schema });
  const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');
  await migrate(db, { migrationsFolder });
  return db;
}

export async function teardownTestDb(): Promise<void> {
  if (sql) await sql.end();
  if (container) await container.stop();
  sql = null;
  db = null;
  container = null;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!db) throw new Error('test db not initialised; call setupTestDb() first');
  return db;
}

export async function truncateAll(): Promise<void> {
  const d = getDb();
  // Order respects FKs (events -> sessions -> projects)
  await d.delete(schema.events);
  await d.delete(schema.sessions);
  await d.delete(schema.projects);
}
