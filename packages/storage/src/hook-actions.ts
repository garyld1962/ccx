import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { appendEvent, type EventRow } from './events.js';
import { ensureSessionForCc, endSession } from './sessions.js';
import { latestPlanId, findIntentByCcTaskId, hasSessionArtifact } from './lookups.js';
import type { GitState } from './git.js';

type Db = PostgresJsDatabase<typeof schema>;

export interface HookSessionRef {
  projectId: string;
  projectName: string;
  host: string;
  ccSessionId: string;
}

export async function recordTaskCreated(
  db: Db,
  ref: HookSessionRef,
  input: { ccTaskId: string; description: string },
): Promise<EventRow | null> {
  if (await findIntentByCcTaskId(db, ref.projectId, input.ccTaskId)) return null;
  const session = await ensureSessionForCc(db, ref);
  const planId = await latestPlanId(db, ref.projectId);
  return appendEvent(db, {
    projectId: ref.projectId,
    sessionId: session.id,
    type: 'Intent',
    payload: {
      parent_plan_id: planId,
      description: input.description.slice(0, 500),
      ordinal: 0,
      cc_task_id: input.ccTaskId,
    },
  });
}

export async function recordTaskCompleted(
  db: Db,
  ref: HookSessionRef,
  input: { ccTaskId: string; git: GitState },
): Promise<EventRow | null> {
  const intent = await findIntentByCcTaskId(db, ref.projectId, input.ccTaskId);
  if (!intent) return null;
  const session = await ensureSessionForCc(db, ref);
  const clean = input.git.workingTreeClean;
  return appendEvent(db, {
    projectId: ref.projectId,
    sessionId: session.id,
    type: 'IntentStatus',
    payload: {
      intent_id: intent.id,
      status: 'completed',
      verification: {
        // HEAD is claimed only when the tree is clean; a dirty tree means the
        // work isn't committed, so no commit is claimed. Never invented.
        commit_sha: clean ? input.git.commitSha : null,
        test_command: null,
        test_exit_code: null,
        evidence_note: clean
          ? `auto: TaskCompleted hook; tree clean at ${input.git.commitSha.slice(0, 12)}`
          : 'auto: TaskCompleted hook; working tree dirty (uncommitted work)',
      },
    },
  });
}

export async function recordArtifactTouch(
  db: Db,
  ref: HookSessionRef,
  input: { path: string; tool: string },
): Promise<EventRow | null> {
  const session = await ensureSessionForCc(db, ref);
  if (await hasSessionArtifact(db, session.id, input.path)) return null;
  return appendEvent(db, {
    projectId: ref.projectId,
    sessionId: session.id,
    type: 'Artifact',
    payload: {
      parent_intent_id: null,
      path: input.path,
      action: 'modified',
      summary: `auto: ${input.tool}`,
    },
  });
}

export async function recordSessionEnd(
  db: Db,
  ref: HookSessionRef,
  input: { git: GitState },
): Promise<EventRow> {
  const session = await ensureSessionForCc(db, ref);
  const ev = await appendEvent(db, {
    projectId: ref.projectId,
    sessionId: session.id,
    type: 'Checkpoint',
    payload: {
      git_branch: input.git.branch,
      git_commit_sha: input.git.commitSha,
      working_tree_clean: input.git.workingTreeClean,
      last_test_command: null,
      last_test_exit_code: null,
      note: 'auto: session end',
    },
  });
  await endSession(db, session.id);
  return ev;
}
