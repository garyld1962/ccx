import { describe, it, expect } from 'vitest';
import { formatDigest, formatTail, formatBlocked, formatDrift, formatProjects } from '../src/format.js';
import type { Digest } from '@ccx/storage';

function digestFixture(overrides: Partial<Digest>): Digest {
  return {
    project_id: 'sha1',
    current_plan: null,
    open_intents: [],
    recent_status_changes: [],
    open_questions: [],
    recent_decisions: [],
    recent_human_feedback: [],
    last_checkpoint: null,
    git: { branch: 'main', commitSha: 'a'.repeat(40), workingTreeClean: true },
    drift: { overclaimed_count: 0, overclaimed: [], baseline_commit_sha: null, note: 'no checkpoint baseline' },
    ...overrides,
  };
}

const digest: Digest = digestFixture({
  current_plan: {
    id: '01J9X8K7M6N5P4Q3R2S1T0V9W8',
    title: 'Build feature X',
    summary: 'Three steps.',
    created_at: '2026-04-25T12:00:00.000Z',
  },
  open_intents: [
    {
      id: '01J9X8K7M6N5P4Q3R2S1T0V9W9',
      description: 'Step A',
      ordinal: 0,
      status: 'started',
      created_at: '2026-04-25T12:01:00.000Z',
    },
    {
      id: '01J9X8K7M6N5P4Q3R2S1T0V9WA',
      description: 'Step B',
      ordinal: 1,
      status: null,
      created_at: '2026-04-25T12:02:00.000Z',
    },
  ],
  git: { branch: 'main', commitSha: 'abc1234567890123456789012345678901234567', workingTreeClean: true },
});

describe('formatDigest', () => {
  it('renders a human-readable digest', () => {
    const out = formatDigest(digest, 'baker-street');
    expect(out).toContain('# ccx digest — baker-street');
    expect(out).toContain('Build feature X');
    expect(out).toContain('Step A');
    expect(out).toContain('Step B');
    expect(out).toContain('main');
    expect(out).toContain('clean');
  });

  it('handles no current plan', () => {
    const empty: Digest = { ...digest, current_plan: null, open_intents: [] };
    const out = formatDigest(empty, 'baker-street');
    expect(out).toContain('no active plan');
  });
});

describe('formatTail', () => {
  it('renders an event row per line', () => {
    const out = formatTail([
      {
        id: '01J9X8K7M6N5P4Q3R2S1T0V9W8',
        type: 'Plan',
        createdAt: new Date('2026-04-25T12:00:00.000Z'),
        payload: { title: 'P' },
      } as never,
    ]);
    expect(out).toContain('Plan');
    expect(out).toContain('01J9X8K7M6N5P4Q3R2S1T0V9W8');
  });
});

describe('formatBlocked', () => {
  it('renders open questions and blocked intents', () => {
    const out = formatBlocked(digestFixture({
      open_questions: [{ id: 'q1', question: 'SSE or poll?', blocks_intent_id: null, created_at: 'T' }],
      open_intents: [{ id: 'i1', description: 'stuck step', ordinal: 0, status: 'blocked', created_at: 'T' }],
    }));
    expect(out).toContain('## Open Questions');
    expect(out).toContain('SSE or poll?');
    expect(out).toContain('## Blocked Intents');
    expect(out).toContain('stuck step');
  });

  it('shows _none_ for empty sections', () => {
    expect(formatBlocked(digestFixture({}))).toContain('_none_');
  });
});

describe('formatDrift', () => {
  it('renders the no-baseline note', () => {
    expect(formatDrift({ overclaimed_count: 0, overclaimed: [], baseline_commit_sha: null, note: 'no checkpoint baseline' }))
      .toContain('no checkpoint baseline');
  });

  it('lists overclaimed intents with reason', () => {
    const out = formatDrift({
      overclaimed_count: 1,
      overclaimed: [{ intent_id: '01J', claimed_commit_sha: 'd'.repeat(40), reason: 'commit_sha does not exist in repo' }],
      baseline_commit_sha: 'a'.repeat(40),
    });
    expect(out).toContain('OVERCLAIMED: 1');
    expect(out).toContain('does not exist in repo');
  });
});

describe('formatProjects', () => {
  it('renders project rows', () => {
    const out = formatProjects([
      { id: 'sha1', name: 'baker-street', createdAt: new Date('2026-07-13T12:00:00Z') } as never,
    ]);
    expect(out).toContain('baker-street');
    expect(out).toContain('sha1');
  });

  it('handles empty list', () => {
    expect(formatProjects([])).toContain('no projects');
  });
});

describe('formatDigest — revised sections', () => {
  it('renders questions/decisions/feedback/checkpoint/drift sections', () => {
    const out = formatDigest(digestFixture({
      open_questions: [{ id: 'q1', question: 'x?', blocks_intent_id: null, created_at: 'T' }],
      recent_decisions: [{ id: 'd1', decision: 'use Drizzle', rationale: 'r', created_at: 'T' }],
      recent_human_feedback: [{ id: 'h1', verbatim: 'go faster', interpreted_as: 'speed', created_at: 'T' }],
      last_checkpoint: { id: 'c1', git_commit_sha: 'a'.repeat(40), working_tree_clean: true, note: 'n', created_at: 'T' },
    }), 'p');
    expect(out).toContain('## Open Questions');
    expect(out).toContain('## Recent Decisions');
    expect(out).toContain('## Recent Human Feedback');
    expect(out).toContain('## Last Checkpoint');
    expect(out).toContain('## Drift');
  });
});
