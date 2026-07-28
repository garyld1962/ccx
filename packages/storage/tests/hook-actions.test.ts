import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, truncateAll, getDb } from './helpers/test-db.js';
import { ensureProject, getProject } from '../src/projects.js';
import { appendEvent } from '../src/events.js';
import { getSession } from '../src/sessions.js';
import {
  recordTaskCreated, recordTaskCompleted, recordArtifactTouch, recordSessionEnd,
} from '../src/hook-actions.js';
import type { GitState } from '../src/git.js';

const REF = { projectId: 'sha1', projectName: 'p', host: 'test-host', ccSessionId: 'cc-1' };
const CLEAN_GIT: GitState = { branch: 'main', commitSha: 'a'.repeat(40), workingTreeClean: true };
const DIRTY_GIT: GitState = { branch: 'main', commitSha: 'a'.repeat(40), workingTreeClean: false };

describe('hook actions', () => {
  beforeAll(async () => { await setupTestDb(); }, 60_000);
  afterEach(async () => { await truncateAll(); });
  afterAll(async () => { await teardownTestDb(); });

  async function seed() {
    await ensureProject(getDb(), { id: 'sha1', name: 'p' });
  }

  it('recordTaskCreated posts an Intent with cc_task_id, attached to the latest plan', async () => {
    await seed();
    const ev = await recordTaskCreated(getDb(), REF, { ccTaskId: 't1', description: 'step one' });
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe('Intent');
    const p = ev!.payload as { parent_plan_id: string | null; cc_task_id: string };
    expect(p.parent_plan_id).toBeNull(); // no plan exists
    expect(p.cc_task_id).toBe('t1');
  });

  it('recordTaskCreated creates the project row when it does not already exist (regression: hook path FK violation)', async () => {
    const ref = { projectId: 'sha-new', projectName: 'brand new project', host: 'test-host', ccSessionId: 'cc-fresh' };
    const ev = await recordTaskCreated(getDb(), ref, { ccTaskId: 't1', description: 'step one' });
    expect(ev).not.toBeNull();
    const project = await getProject(getDb(), 'sha-new');
    expect(project).not.toBeNull();
    expect(project?.name).toBe('brand new project');
  });

  it('recordTaskCreated is idempotent per cc_task_id', async () => {
    await seed();
    await recordTaskCreated(getDb(), REF, { ccTaskId: 't1', description: 'step one' });
    const second = await recordTaskCreated(getDb(), REF, { ccTaskId: 't1', description: 'step one' });
    expect(second).toBeNull();
  });

  it('recordTaskCompleted posts IntentStatus with commit sha only when tree is clean', async () => {
    await seed();
    await recordTaskCreated(getDb(), REF, { ccTaskId: 't1', description: 'step one' });
    const done = await recordTaskCompleted(getDb(), REF, { ccTaskId: 't1', git: CLEAN_GIT });
    expect(done).not.toBeNull();
    const p = done!.payload as { status: string; verification: { commit_sha: string | null; evidence_note: string } };
    expect(p.status).toBe('completed');
    expect(p.verification.commit_sha).toBe(CLEAN_GIT.commitSha);
    expect(p.verification.evidence_note).toMatch(/auto/i);
  });

  it('recordTaskCompleted uses null commit sha when tree is dirty', async () => {
    await seed();
    await recordTaskCreated(getDb(), REF, { ccTaskId: 't2', description: 'step two' });
    const done = await recordTaskCompleted(getDb(), REF, { ccTaskId: 't2', git: DIRTY_GIT });
    const p = done!.payload as { verification: { commit_sha: string | null } };
    expect(p.verification.commit_sha).toBeNull();
  });

  it('recordTaskCompleted skips unknown task ids', async () => {
    await seed();
    expect(await recordTaskCompleted(getDb(), REF, { ccTaskId: 'nope', git: CLEAN_GIT })).toBeNull();
  });

  it('recordArtifactTouch posts once per session+path', async () => {
    await seed();
    const first = await recordArtifactTouch(getDb(), REF, { path: 'src/a.ts', tool: 'Edit' });
    expect(first!.type).toBe('Artifact');
    expect(await recordArtifactTouch(getDb(), REF, { path: 'src/a.ts', tool: 'Write' })).toBeNull();
    expect(await recordArtifactTouch(getDb(), REF, { path: 'src/b.ts', tool: 'Edit' })).not.toBeNull();
  });

  it('recordSessionEnd posts a Checkpoint and ends the session', async () => {
    await seed();
    const ev = await recordSessionEnd(getDb(), REF, { git: CLEAN_GIT });
    expect(ev.type).toBe('Checkpoint');
    const session = await getSession(getDb(), ev.sessionId);
    expect(session?.endedAt).not.toBeNull();
  });
});
