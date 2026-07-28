import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, truncateAll, getDb } from './helpers/test-db.js';
import { ensureProject } from '../src/projects.js';
import { createSession } from '../src/sessions.js';
import { appendEvent } from '../src/events.js';
import { latestPlanId, findIntentByCcTaskId, hasSessionArtifact } from '../src/lookups.js';

describe('lookups', () => {
  beforeAll(async () => { await setupTestDb(); }, 60_000);
  afterEach(async () => { await truncateAll(); });
  afterAll(async () => { await teardownTestDb(); });

  async function seed() {
    await ensureProject(getDb(), { id: 'sha1', name: 'p' });
    return createSession(getDb(), { projectId: 'sha1', host: 'test-host' });
  }

  it('latestPlanId returns null with no plans, then the newest plan id', async () => {
    const s = await seed();
    expect(await latestPlanId(getDb(), 'sha1')).toBeNull();
    await appendEvent(getDb(), { projectId: 'sha1', sessionId: s.id, type: 'Plan', payload: { title: 'A', summary: 'a' } });
    const p2 = await appendEvent(getDb(), { projectId: 'sha1', sessionId: s.id, type: 'Plan', payload: { title: 'B', summary: 'b' } });
    expect(await latestPlanId(getDb(), 'sha1')).toBe(p2.id);
  });

  it('findIntentByCcTaskId finds the intent, scoped to project', async () => {
    const s = await seed();
    await ensureProject(getDb(), { id: 'other', name: 'o' });
    const intent = await appendEvent(getDb(), {
      projectId: 'sha1', sessionId: s.id, type: 'Intent',
      payload: { parent_plan_id: null, description: 'x', ordinal: 0, cc_task_id: 'task-1' },
    });
    expect((await findIntentByCcTaskId(getDb(), 'sha1', 'task-1'))?.id).toBe(intent.id);
    expect(await findIntentByCcTaskId(getDb(), 'sha1', 'task-2')).toBeNull();
    expect(await findIntentByCcTaskId(getDb(), 'other', 'task-1')).toBeNull();
  });

  it('hasSessionArtifact is true only for the same session + path', async () => {
    const s = await seed();
    await appendEvent(getDb(), {
      projectId: 'sha1', sessionId: s.id, type: 'Artifact',
      payload: { parent_intent_id: null, path: 'src/a.ts', action: 'modified', summary: 'auto: Edit' },
    });
    expect(await hasSessionArtifact(getDb(), s.id, 'src/a.ts')).toBe(true);
    expect(await hasSessionArtifact(getDb(), s.id, 'src/b.ts')).toBe(false);
    const s2 = await createSession(getDb(), { projectId: 'sha1', host: 'test-host' });
    expect(await hasSessionArtifact(getDb(), s2.id, 'src/a.ts')).toBe(false);
  });
});
