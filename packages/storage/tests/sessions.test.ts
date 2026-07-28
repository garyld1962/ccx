import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, truncateAll, getDb } from './helpers/test-db.js';
import { ensureProject, getProject } from '../src/projects.js';
import { createSession, endSession, getSession, ensureSessionForCc } from '../src/sessions.js';

beforeAll(async () => { await setupTestDb(); }, 60_000);
afterEach(async () => { await truncateAll(); });
afterAll(async () => { await teardownTestDb(); });

describe('sessions', () => {
  async function seed() {
    await ensureProject(getDb(), { id: 'sha1', name: 'p' });
  }

  it('createSession persists a row with host', async () => {
    await seed();
    const s = await createSession(getDb(), { projectId: 'sha1', host: 'test-host' });
    expect(s.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(s.host).toBe('test-host');
    expect(s.endedAt).toBeNull();
  });

  it('endSession sets endedAt', async () => {
    await seed();
    const s = await createSession(getDb(), { projectId: 'sha1', host: 'test-host' });
    await endSession(getDb(), s.id);
    const got = await getSession(getDb(), s.id);
    expect(got?.endedAt).not.toBeNull();
  });

  it('endSession on already-ended session is a no-op', async () => {
    await seed();
    const s = await createSession(getDb(), { projectId: 'sha1', host: 'test-host' });
    await endSession(getDb(), s.id);
    await endSession(getDb(), s.id);
    const got = await getSession(getDb(), s.id);
    expect(got?.endedAt).not.toBeNull();
  });
});

describe('ensureSessionForCc', () => {
  it('creates a session keyed by cc_session_id', async () => {
    await ensureProject(getDb(), { id: 'sha1', name: 'p' });
    const s = await ensureSessionForCc(getDb(), {
      projectId: 'sha1', projectName: 'p', host: 'test-host', ccSessionId: 'cc-abc',
    });
    expect(s.ccSessionId).toBe('cc-abc');
    expect(s.endedAt).toBeNull();
  });

  it('returns the same session on repeat calls with the same cc_session_id', async () => {
    await ensureProject(getDb(), { id: 'sha1', name: 'p' });
    const a = await ensureSessionForCc(getDb(), { projectId: 'sha1', projectName: 'p', host: 'test-host', ccSessionId: 'cc-abc' });
    const b = await ensureSessionForCc(getDb(), { projectId: 'sha1', projectName: 'p', host: 'test-host', ccSessionId: 'cc-abc' });
    expect(b.id).toBe(a.id);
  });

  it('creates the project row when it does not already exist (regression: hook path FK violation)', async () => {
    const s = await ensureSessionForCc(getDb(), {
      projectId: 'sha-new', projectName: 'brand new project', host: 'test-host', ccSessionId: 'cc-fresh',
    });
    expect(s.projectId).toBe('sha-new');
    const project = await getProject(getDb(), 'sha-new');
    expect(project).not.toBeNull();
    expect(project?.name).toBe('brand new project');
  });
});
