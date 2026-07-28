import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, truncateAll, getDb } from './helpers/test-db.js';
import { ensureProject, getProject } from '../src/projects.js';

describe('projects', () => {
  beforeAll(async () => { await setupTestDb(); }, 60_000);
  afterEach(async () => { await truncateAll(); });
  afterAll(async () => { await teardownTestDb(); });

  it('ensureProject inserts a new row', async () => {
    const p = await ensureProject(getDb(), { id: 'sha1', name: 'baker-street' });
    expect(p.id).toBe('sha1');
    expect(p.name).toBe('baker-street');
  });

  it('ensureProject is idempotent', async () => {
    await ensureProject(getDb(), { id: 'sha1', name: 'baker-street' });
    await ensureProject(getDb(), { id: 'sha1', name: 'baker-street' });
    const got = await getProject(getDb(), 'sha1');
    expect(got).not.toBeNull();
  });

  it('ensureProject does NOT overwrite name', async () => {
    await ensureProject(getDb(), { id: 'sha1', name: 'original' });
    await ensureProject(getDb(), { id: 'sha1', name: 'renamed' });
    const got = await getProject(getDb(), 'sha1');
    expect(got?.name).toBe('original');
  });

  it('getProject returns null when missing', async () => {
    const got = await getProject(getDb(), 'nope');
    expect(got).toBeNull();
  });
});
