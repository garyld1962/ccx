import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupTestDb, teardownTestDb, truncateAll, getDb } from './helpers/test-db.js';
import { makeGitRepo, rmGitRepo } from './helpers/git-fixture.js';
import { ensureProject } from '../src/projects.js';
import { createSession } from '../src/sessions.js';
import { appendEvent } from '../src/events.js';
import { computeDrift } from '../src/drift.js';

describe('computeDrift', () => {
  beforeAll(async () => { await setupTestDb(); }, 60_000);
  afterEach(async () => { await truncateAll(); });
  afterAll(async () => { await teardownTestDb(); });

  async function seed() {
    await ensureProject(getDb(), { id: 'sha1', name: 'p' });
    return createSession(getDb(), { projectId: 'sha1', host: 'test-host' });
  }

  it('returns no-baseline note when no Checkpoint exists', async () => {
    const tmp = makeGitRepo();
    try {
      await seed();
      const d = await computeDrift(getDb(), { projectId: 'sha1', cwd: tmp });
      expect(d.overclaimed_count).toBe(0);
      expect(d.note).toMatch(/no checkpoint/i);
    } finally { rmGitRepo(tmp); }
  });

  it('flags a completion whose commit_sha does not exist in the repo', async () => {
    const tmp = makeGitRepo();
    try {
      const s = await seed();
      const baselineSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim();

      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Checkpoint',
        payload: {
          git_branch: 'main', git_commit_sha: baselineSha,
          working_tree_clean: true,
          last_test_command: null, last_test_exit_code: null,
          note: 'baseline',
        },
      });

      const plan = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Plan',
        payload: { title: 'P', summary: 'S' },
      });
      const intent = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Intent',
        payload: { parent_plan_id: plan.id, description: 'X', ordinal: 0 },
      });
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'IntentStatus',
        payload: {
          intent_id: intent.id, status: 'completed',
          verification: {
            commit_sha: 'd'.repeat(40),  // does not exist
            test_command: null, test_exit_code: null, evidence_note: 'fake',
          },
        },
      });

      const d = await computeDrift(getDb(), { projectId: 'sha1', cwd: tmp });
      expect(d.overclaimed_count).toBe(1);
      expect(d.overclaimed[0]?.intent_id).toBe(intent.id);
      expect(d.overclaimed[0]?.reason).toMatch(/does not exist/);
    } finally { rmGitRepo(tmp); }
  });

  it('does not flag completions with null commit_sha (manual evidence)', async () => {
    const tmp = makeGitRepo();
    try {
      const s = await seed();
      const baselineSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim();
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Checkpoint',
        payload: {
          git_branch: 'main', git_commit_sha: baselineSha,
          working_tree_clean: true,
          last_test_command: null, last_test_exit_code: null, note: 'baseline',
        },
      });
      const plan = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Plan',
        payload: { title: 'P', summary: 'S' },
      });
      const intent = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Intent',
        payload: { parent_plan_id: plan.id, description: 'X', ordinal: 0 },
      });
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'IntentStatus',
        payload: {
          intent_id: intent.id, status: 'completed',
          verification: { commit_sha: null, test_command: null, test_exit_code: null, evidence_note: 'manual smoke' },
        },
      });
      const d = await computeDrift(getDb(), { projectId: 'sha1', cwd: tmp });
      expect(d.overclaimed_count).toBe(0);
    } finally { rmGitRepo(tmp); }
  });

  it('flags a completion whose commit_sha exists but is not in the post-baseline range', async () => {
    const tmp = makeGitRepo();
    try {
      const s = await seed();
      // Commit X at HEAD, then a SECOND commit Y, baseline Checkpoint at Y, then claim X.
      const xSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim();
      fs.writeFileSync(path.join(tmp, 'b.txt'), 'b');
      execFileSync('git', ['add', '.'], { cwd: tmp });
      execFileSync('git', ['commit', '-q', '-m', 'two'], { cwd: tmp });
      const ySha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim();

      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Checkpoint',
        payload: {
          git_branch: 'main', git_commit_sha: ySha,
          working_tree_clean: true,
          last_test_command: null, last_test_exit_code: null, note: 'baseline',
        },
      });
      const plan = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Plan',
        payload: { title: 'P', summary: 'S' },
      });
      const intent = await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'Intent',
        payload: { parent_plan_id: plan.id, description: 'X', ordinal: 0 },
      });
      await appendEvent(getDb(), {
        projectId: 'sha1', sessionId: s.id, type: 'IntentStatus',
        payload: {
          intent_id: intent.id, status: 'completed',
          verification: {
            commit_sha: xSha,  // exists but pre-baseline
            test_command: null, test_exit_code: null, evidence_note: 'wrong era',
          },
        },
      });

      const d = await computeDrift(getDb(), { projectId: 'sha1', cwd: tmp });
      expect(d.overclaimed_count).toBe(1);
      expect(d.overclaimed[0]?.reason).toMatch(/before checkpoint/i);
    } finally { rmGitRepo(tmp); }
  });
});
