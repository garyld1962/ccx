import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

export interface CcxClient {
  db: Db;
  close(): Promise<void>;
}

export interface ClientOptions {
  connectTimeoutSeconds?: number;
}

export function createClient(url: string, opts: ClientOptions = {}): CcxClient {
  const sql: Sql = postgres(url, { max: 5, connect_timeout: opts.connectTimeoutSeconds ?? 30 });
  const db = drizzle(sql, { schema });
  return {
    db,
    async close() {
      await sql.end();
    },
  };
}
