import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { setupTestDb, teardownTestDb, truncateAll, getDb } from './helpers/test-db.js';
import { makeGitRepo, rmGitRepo } from './helpers/git-fixture.js';
import { ensureProject } from '../src/projects.js';
import { createSession } from '../src/sessions.js';
import { appendEvent } from '../src/events.js';
import { computeDigest } from '../src/digest.js';

const STUB_GIT = { branch: 'main', commitSha: 'a'.repeat(40), workingTreeClean: true };

describe('computeDigest', () => {
  beforeAll(async () => { await setupTestDb(); }, 60_000);
  afterEach(async () => { await truncateAll(); });
  afterAll(async () => { await teardownTestDb(); });

  async function seed() {
    await ensureProject(getDb(), { id: 'sha1', name: 'p' });
    return createSession(getDb(), { projectId: 'sha1', host: 'test-host' });
  }

  it('returns null current_plan when no Plan exists', async () => {
    const tmp = makeGitRepo();
    try {
      await seed();
      const d = await computeDigest(getDb(), { projectId: 'sha1', git: STUB_GIT, cwd: tmp });
      expect(d.current_plan).toBeNull();
      expect(d.open_intents).toEqual([]);
    } finally { rmGitRepo(tmp); }
  });

  it('returns latest Plan as current and lists open intents', async () => {
    const tmp = makeGitRepo();
    try {
      const s = await seed();
      const plan = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Plan',
        payload: { title: 'P', summary: 'S' },
      });
      const intentA = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Intent',
        payload: { parent_plan_id: plan.id, description: 'A', ordinal: 0 },
      });
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Intent',
        payload: { parent_plan_id: plan.id, description: 'B', ordinal: 1 },
      });
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'IntentStatus',
        payload: { intent_id: intentA.id, status: 'started' },
      });

      const d = await computeDigest(getDb(), { projectId: 'sha1', git: STUB_GIT, cwd: tmp });
      expect(d.current_plan?.id).toBe(plan.id);
      expect(d.open_intents).toHaveLength(2);
      const aOpen = d.open_intents.find((i) => i.id === intentA.id);
      expect(aOpen?.status).toBe('started');
    } finally { rmGitRepo(tmp); }
  });

  it('excludes terminally-closed intents from open_intents', async () => {
    const tmp = makeGitRepo();
    try {
      const s = await seed();
      const plan = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Plan',
        payload: { title: 'P', summary: 'S' },
      });
      const intent = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Intent',
        payload: { parent_plan_id: plan.id, description: 'A', ordinal: 0 },
      });
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'IntentStatus',
        payload: {
          intent_id: intent.id, status: 'completed',
          verification: { commit_sha: null, test_command: null, test_exit_code: null, evidence_note: 'done' },
        },
      });
      const d = await computeDigest(getDb(), { projectId: 'sha1', git: STUB_GIT, cwd: tmp });
      expect(d.open_intents).toHaveLength(0);
    } finally { rmGitRepo(tmp); }
  });

  it('uses latest Plan when multiple exist (Phase 1 ignores supersedes graph)', async () => {
    const tmp = makeGitRepo();
    try {
      const s = await seed();
      const p1 = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Plan',
        payload: { title: 'P1', summary: 'S' },
      });
      const p2 = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Plan',
        payload: { title: 'P2', summary: 'S', supersedes: p1.id },
      });
      const d = await computeDigest(getDb(), { projectId: 'sha1', git: STUB_GIT, cwd: tmp });
      expect(d.current_plan?.id).toBe(p2.id);
    } finally { rmGitRepo(tmp); }
  });

  it('includes git state', async () => {
    const tmp = makeGitRepo();
    try {
      await seed();
      const d = await computeDigest(getDb(), { projectId: 'sha1', git: STUB_GIT, cwd: tmp });
      expect(d.git).toEqual(STUB_GIT);
    } finally { rmGitRepo(tmp); }
  });

  it('surfaces plan-less (hook-captured) open intents', async () => {
    const tmp = makeGitRepo();
    try {
      const s = await seed();
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Intent',
        payload: { parent_plan_id: null, description: 'hook intent', ordinal: 0, cc_task_id: 't1' },
      });
      const d = await computeDigest(getDb(), { projectId: 'sha1', git: STUB_GIT, cwd: tmp });
      expect(d.current_plan).toBeNull();
      expect(d.open_intents).toHaveLength(1);
      expect(d.open_intents[0]?.description).toBe('hook intent');
    } finally { rmGitRepo(tmp); }
  });

  it('open_intents surfaces blocked status', async () => {
    const tmp = makeGitRepo();
    try {
      const s = await seed();
      const plan = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Plan',
        payload: { title: 'P', summary: 'S' },
      });
      const intent = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Intent',
        payload: { parent_plan_id: plan.id, description: 'A', ordinal: 0 },
      });
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'IntentStatus',
        payload: { intent_id: intent.id, status: 'blocked', reason: 'waiting' },
      });
      const d = await computeDigest(getDb(), { projectId: 'sha1', git: STUB_GIT, cwd: tmp });
      expect(d.open_intents[0]?.status).toBe('blocked');
    } finally { rmGitRepo(tmp); }
  });

  it('surfaces open Questions, recent Decisions, recent HumanFeedback, last Checkpoint, real drift', async () => {
    const tmp = makeGitRepo();
    try {
      const s = await seed();
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Question',
        payload: { question: 'should we use SSE?' },
      });
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Decision',
        payload: { decision: 'use Drizzle', rationale: 'best ergonomics' },
      });
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'HumanFeedback',
        payload: { verbatim: 'use postgres', interpreted_as: 'switch storage backend' },
      });
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Checkpoint',
        payload: {
          git_branch: 'main',
          git_commit_sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim(),
          working_tree_clean: true,
          last_test_command: null, last_test_exit_code: null, note: 'baseline',
        },
      });

      const d = await computeDigest(getDb(), { projectId: 'sha1', git: STUB_GIT, cwd: tmp });
      expect(d.open_questions).toHaveLength(1);
      expect(d.recent_decisions).toHaveLength(1);
      expect(d.recent_human_feedback).toHaveLength(1);
      expect(d.last_checkpoint).not.toBeNull();
      expect(d.drift.overclaimed_count).toBe(0);
      expect(d.drift.baseline_commit_sha).not.toBeNull();
    } finally { rmGitRepo(tmp); }
  });
});
