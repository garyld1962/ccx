import { eq, and, desc, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import type { GitState } from './git.js';
import type { DriftReport } from './drift.js';
import { computeDrift } from './drift.js';

export interface DigestPlan {
  id: string;
  title: string;
  summary: string;
  created_at: string;
}

export interface DigestQuestion {
  id: string;
  question: string;
  blocks_intent_id: string | null;
  created_at: string;
}

export interface DigestDecision {
  id: string;
  decision: string;
  rationale: string;
  created_at: string;
}

export interface DigestHumanFeedback {
  id: string;
  verbatim: string;
  interpreted_as: string;
  created_at: string;
}

export interface DigestCheckpoint {
  id: string;
  git_commit_sha: string;
  working_tree_clean: boolean;
  note: string;
  created_at: string;
}

export interface DigestIntent {
  id: string;
  description: string;
  ordinal: number;
  status: 'started' | 'blocked' | null;
  created_at: string;
}

export interface DigestStatusChange {
  intent_id: string;
  intent_description: string;
  status: 'started' | 'completed' | 'blocked' | 'abandoned';
  created_at: string;
}

export interface Digest {
  project_id: string;
  current_plan: DigestPlan | null;
  open_intents: DigestIntent[]; // plan intents + plan-less (hook-captured) intents
  recent_status_changes: DigestStatusChange[];
  open_questions: DigestQuestion[];
  recent_decisions: DigestDecision[]; // last 5
  recent_human_feedback: DigestHumanFeedback[]; // last 3
  last_checkpoint: DigestCheckpoint | null;
  git: GitState;
  drift: DriftReport;
}

export async function computeDigest(
  db: PostgresJsDatabase<typeof schema>,
  input: { projectId: string; git: GitState; cwd: string },
): Promise<Digest> {
  const { projectId, git } = input;

  const [latestPlan] = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'Plan')))
    .orderBy(desc(schema.events.createdAt))
    .limit(1);

  let currentPlan: DigestPlan | null = null;

  if (latestPlan) {
    const planPayload = latestPlan.payload as { title: string; summary: string };
    currentPlan = {
      id: latestPlan.id,
      title: planPayload.title,
      summary: planPayload.summary,
      created_at: latestPlan.createdAt.toISOString(),
    };
  }

  const intentRows = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'Intent')));

  const statusRows = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'IntentStatus')))
    .orderBy(desc(schema.events.createdAt));

  const latestStatusByIntent = new Map<string, 'started' | 'completed' | 'blocked' | 'abandoned'>();
  for (const r of statusRows) {
    const p = r.payload as { intent_id: string; status: 'started' | 'completed' | 'blocked' | 'abandoned' };
    if (!latestStatusByIntent.has(p.intent_id)) {
      latestStatusByIntent.set(p.intent_id, p.status);
    }
  }

  const relevantIntents = intentRows.filter((r) => {
    const parent = (r.payload as { parent_plan_id: string | null }).parent_plan_id;
    return parent === (latestPlan?.id ?? null) || parent === null;
  });

  const openIntents: DigestIntent[] = relevantIntents
    .filter((r) => {
      const s = latestStatusByIntent.get(r.id);
      return s === undefined || s === 'started' || s === 'blocked';
    })
    .map((r) => {
      const p = r.payload as { description: string; ordinal: number };
      const s = latestStatusByIntent.get(r.id);
      const status: 'started' | 'blocked' | null =
        s === 'started' ? 'started' : s === 'blocked' ? 'blocked' : null;
      return {
        id: r.id,
        description: p.description,
        ordinal: p.ordinal,
        status,
        created_at: r.createdAt.toISOString(),
      };
    })
    .sort((a, b) => a.ordinal - b.ordinal || a.created_at.localeCompare(b.created_at));

  const recentStatuses = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'IntentStatus')))
    .orderBy(desc(schema.events.createdAt))
    .limit(5);

  const intentIdsNeeded = recentStatuses.map(
    (r) => (r.payload as { intent_id: string }).intent_id,
  );
  const intentDescriptions = new Map<string, string>();
  if (intentIdsNeeded.length > 0) {
    const intentRowsForStatuses = await db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.projectId, projectId),
          eq(schema.events.type, 'Intent'),
          inArray(schema.events.id, intentIdsNeeded),
        ),
      );
    for (const r of intentRowsForStatuses) {
      intentDescriptions.set(r.id, (r.payload as { description: string }).description);
    }
  }

  const recent_status_changes: DigestStatusChange[] = recentStatuses.map((r) => {
    const p = r.payload as { intent_id: string; status: 'started' | 'completed' | 'blocked' | 'abandoned' };
    return {
      intent_id: p.intent_id,
      intent_description: intentDescriptions.get(p.intent_id) ?? '<unknown intent>',
      status: p.status,
      created_at: r.createdAt.toISOString(),
    };
  });

  const questionRows = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'Question')))
    .orderBy(desc(schema.events.createdAt))
    .limit(50);
  const open_questions: DigestQuestion[] = questionRows.map((r) => {
    const p = r.payload as { question: string; blocks_intent_id: string | null };
    return {
      id: r.id,
      question: p.question,
      blocks_intent_id: p.blocks_intent_id,
      created_at: r.createdAt.toISOString(),
    };
  });

  const decisionRows = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'Decision')))
    .orderBy(desc(schema.events.createdAt))
    .limit(5);
  const recent_decisions: DigestDecision[] = decisionRows.map((r) => {
    const p = r.payload as { decision: string; rationale: string };
    return {
      id: r.id,
      decision: p.decision,
      rationale: p.rationale,
      created_at: r.createdAt.toISOString(),
    };
  });

  const feedbackRows = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'HumanFeedback')))
    .orderBy(desc(schema.events.createdAt))
    .limit(3);
  const recent_human_feedback: DigestHumanFeedback[] = feedbackRows.map((r) => {
    const p = r.payload as { verbatim: string; interpreted_as: string };
    return {
      id: r.id,
      verbatim: p.verbatim,
      interpreted_as: p.interpreted_as,
      created_at: r.createdAt.toISOString(),
    };
  });

  const [latestCheckpointRow] = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'Checkpoint')))
    .orderBy(desc(schema.events.createdAt))
    .limit(1);
  const last_checkpoint: DigestCheckpoint | null = latestCheckpointRow
    ? (() => {
        const p = latestCheckpointRow.payload as {
          git_commit_sha: string;
          working_tree_clean: boolean;
          note: string;
        };
        return {
          id: latestCheckpointRow.id,
          git_commit_sha: p.git_commit_sha,
          working_tree_clean: p.working_tree_clean,
          note: p.note,
          created_at: latestCheckpointRow.createdAt.toISOString(),
        };
      })()
    : null;

  const drift = await computeDrift(db, { projectId, cwd: input.cwd });

  return {
    project_id: projectId,
    current_plan: currentPlan,
    open_intents: openIntents,
    recent_status_changes,
    open_questions,
    recent_decisions,
    recent_human_feedback,
    last_checkpoint,
    git,
    drift,
  };
}
