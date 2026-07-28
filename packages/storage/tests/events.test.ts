import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, truncateAll, getDb } from './helpers/test-db.js';
import { ensureProject } from '../src/projects.js';
import { createSession } from '../src/sessions.js';
import { appendEvent, queryEvents } from '../src/events.js';

describe('events', () => {
  beforeAll(async () => { await setupTestDb(); }, 60_000);
  afterEach(async () => { await truncateAll(); });
  afterAll(async () => { await teardownTestDb(); });

  async function seed() {
    await ensureProject(getDb(), { id: 'sha1', name: 'p' });
    return createSession(getDb(), { projectId: 'sha1', host: 'test-host' });
  }

  it('appendEvent validates payload against the registry and inserts', async () => {
    const s = await seed();
    const ev = await appendEvent(getDb(), {
      projectId: 'sha1',
      sessionId: s.id,
      type: 'Plan',
      payload: { title: 'T', summary: 'S' },
    });
    expect(ev.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ev.type).toBe('Plan');
    expect((ev.payload as { title: string }).title).toBe('T');
  });

  it('appendEvent normalises Plan payload (supersedes defaults to null)', async () => {
    const s = await seed();
    const ev = await appendEvent(getDb(), {
      projectId: 'sha1',
      sessionId: s.id,
      type: 'Plan',
      payload: { title: 'T', summary: 'S' },
    });
    expect((ev.payload as { supersedes: string | null }).supersedes).toBeNull();
  });

  it('appendEvent rejects an invalid payload', async () => {
    const s = await seed();
    await expect(
      appendEvent(getDb(), {
        projectId: 'sha1',
        sessionId: s.id,
        type: 'Plan',
        payload: { title: '', summary: 'S' },
      }),
    ).rejects.toThrow();
  });

  it('appendEvent rejects unknown type', async () => {
    const s = await seed();
    await expect(
      appendEvent(getDb(), {
        projectId: 'sha1',
        sessionId: s.id,
        // @ts-expect-error - testing runtime guard
        type: 'NotARealType',
        payload: {},
      }),
    ).rejects.toThrow();
  });

  it('queryEvents filters by type and orders newest first', async () => {
    const s = await seed();
    await appendEvent(getDb(), {
      projectId: 'sha1', sessionId: s.id, type: 'Plan',
      payload: { title: 'P1', summary: 'S' },
    });
    const planB = await appendEvent(getDb(), {
      projectId: 'sha1', sessionId: s.id, type: 'Plan',
      payload: { title: 'P2', summary: 'S' },
    });
    await appendEvent(getDb(), {
      projectId: 'sha1', sessionId: s.id, type: 'Intent',
      payload: { parent_plan_id: planB.id, description: 'D', ordinal: 0 },
    });

    const plans = await queryEvents(getDb(), { projectId: 'sha1', type: 'Plan' });
    expect(plans).toHaveLength(2);
    expect(plans[0]?.id).toBe(planB.id);

    const limited = await queryEvents(getDb(), { projectId: 'sha1', limit: 2 });
    expect(limited).toHaveLength(2);
  });
});
