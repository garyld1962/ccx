import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, getDb } from './test-db.js';
import { projects } from '../../src/schema.js';

describe('test-db helper', () => {
  beforeAll(async () => { await setupTestDb(); }, 60_000);
  afterAll(async () => { await teardownTestDb(); });

  it('runs migrations and allows insert', async () => {
    const db = getDb();
    await db.insert(projects).values({ id: 'sha1', name: 'test' });
    const rows = await db.select().from(projects);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('test');
  });
});
