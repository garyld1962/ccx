import { eq, and, desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { commitsSince, commitExists } from './git.js';

export interface DriftEntry {
  intent_id: string;
  claimed_commit_sha: string;
  reason: string;
}

export interface DriftReport {
  overclaimed_count: number;
  overclaimed: DriftEntry[];
  baseline_commit_sha: string | null;
  note?: string;
}

export async function computeDrift(
  db: PostgresJsDatabase<typeof schema>,
  input: { projectId: string; cwd: string },
): Promise<DriftReport> {
  const { projectId, cwd } = input;

  const [latestCheckpoint] = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'Checkpoint')))
    .orderBy(desc(schema.events.createdAt))
    .limit(1);

  if (!latestCheckpoint) {
    return {
      overclaimed_count: 0,
      overclaimed: [],
      baseline_commit_sha: null,
      note: 'no checkpoint baseline',
    };
  }

  const baselineSha = (latestCheckpoint.payload as { git_commit_sha: string }).git_commit_sha;

  // commitsSince throws if baseline is unknown to the repo. Surface as a "stale baseline" note.
  let postBaselineCommits: Set<string>;
  try {
    postBaselineCommits = new Set(commitsSince(cwd, baselineSha));
    postBaselineCommits.add(baselineSha); // baseline itself is "valid"
  } catch {
    return {
      overclaimed_count: 0,
      overclaimed: [],
      baseline_commit_sha: baselineSha,
      note: 'baseline commit not found in current repo (different branch or rebased history)',
    };
  }

  const completions = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'IntentStatus')));

  const overclaimed: DriftEntry[] = [];
  for (const row of completions) {
    if (row.createdAt <= latestCheckpoint.createdAt) continue;
    const p = row.payload as {
      intent_id: string;
      status: string;
      verification?: { commit_sha: string | null };
    };
    if (p.status !== 'completed') continue;
    const claimed = p.verification?.commit_sha;
    if (claimed === null || claimed === undefined) continue;

    if (!commitExists(cwd, claimed)) {
      overclaimed.push({
        intent_id: p.intent_id,
        claimed_commit_sha: claimed,
        reason: 'commit_sha does not exist in repo',
      });
    } else if (!postBaselineCommits.has(claimed)) {
      overclaimed.push({
        intent_id: p.intent_id,
        claimed_commit_sha: claimed,
        reason: 'commit_sha exists but was made before checkpoint baseline',
      });
    }
  }

  return {
    overclaimed_count: overclaimed.length,
    overclaimed,
    baseline_commit_sha: baselineSha,
  };
}
