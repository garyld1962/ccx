# ccx Phase 1 — Plan 2 (Revised): Hooks-Based Capture + Read Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Supersedes:** `2026-04-25-phase-1-plan-2-event-types-and-read-tools.md` in full. Do not execute that document. Tasks that survived the redesign are reproduced here verbatim or adapted; everything else is cancelled (rationale below).

**Goal:** Finish Phase 1 with capture shifted from *voluntary* (the model posts events because CLAUDE.md asks it to) to *mechanical* (Claude Code hooks post events derived from ground truth) wherever ground truth exists. Adds the hook capture layer (`ccx hook …`), a trimmed semantic MCP surface (`ccx_post_decision|question|human_feedback`), the two read tools (`ccx_query`, `ccx_drift_check`), the real drift check, digest injection at session start, fail-soft behavior when Postgres is down, and the four remaining CLI commands.

**Architecture:** TypeScript pnpm monorepo, unchanged packages (`@ccx/schema`, `@ccx/storage`, `@ccx/mcp-server`, `@ccx/cli`). Postgres canonical store (SQLite fallback remains Plan 3). New: the CLI grows a write path — `ccx hook <event>` subcommands invoked by Claude Code hooks, reading the hook's JSON from stdin and writing events via `@ccx/storage`. Hook-derived event logic lives in `@ccx/storage` (`hook-actions.ts`) so it is integration-tested with testcontainers; the CLI layer is thin plumbing.

**Tech stack additions:** none. Same Zod, Drizzle, postgres-js, MCP SDK, commander, smol-toml.

**Reference:** `docs/handoff.md` for event payload specs. This plan **amends** handoff.md's design (see "Design deltas" below); where they conflict, this plan wins.

---

## Why this revision exists

The April design had schema-validated events but left *whether anything gets posted* to CLAUDE.md prose — the same voluntary-compliance mechanism that killed Session.md. Since April, Claude Code shipped a rich hook system (`SessionStart`, `SessionEnd`, `PostToolUse`, `TaskCreated`, `TaskCompleted`, …) that can run arbitrary commands with the event JSON on stdin, and native task tracking (TaskCreate/TaskUpdate) that the harness itself nudges the model to use. That lets ccx capture the bookkeeping tier deterministically and reserve model-authored posting for events only the model can know.

A second driver: with the Postgres host unreachable, the old design made every session start with a failing tool call that returned a raw SQL error. This plan makes every hook and the MCP digest fail soft.

## Design deltas vs `docs/handoff.md`

- **D5 amended (capture surfaces).** Three surfaces, not two: hooks (mechanical capture — the primary write path), MCP (semantic events + reads), CLI (human reads + the `hook` plumbing). Hooks call the CLI binary; the 50–150ms process spawn is irrelevant because hooks run out-of-band, not in the agent's turn.
- **Event roster trimmed for Phase 1.** Kept: `Plan`, `Intent`, `IntentStatus`, `Decision`, `Question`, `HumanFeedback` (model-authored via MCP) and `Checkpoint`, `Artifact` (hook-authored; `Intent`/`IntentStatus` are also hook-authored via the native-task bridge). Deferred to Phase 2: `Assumption`, `Discovery` (Claude Code's native auto-memory now covers this tier), `Revert` (git history + drift check cover it), `Issue` (fold into `Question` for now), `PlanComplete` (the digest infers completion: current plan with zero open intents). The `EventType` enum keeps all 13 names reserved; only 8 validators are registered — posting an unregistered type errors, which is the correct guard.
- **`Intent.parent_plan_id` becomes nullable** and `Intent` gains optional `cc_task_id`. Hook-captured intents (from native TaskCreated) may have no plan; they attach to the latest Plan if one exists, else null. The digest surfaces plan-less open intents alongside plan intents.
- **Digest delivery inverted.** A `SessionStart` hook injects the digest into context (`additionalContext`) instead of instructing the model to call `ccx_digest()` first. The MCP `ccx_digest` tool remains for mid-session re-reads.
- **Fail-soft is a hard rule.** `ccx hook` subcommands always exit 0; failures append one line to `~/.ccx/hook-errors.log`. A dead store must never block or noise up a Claude Code session. The MCP digest returns a structured "store unavailable — proceed without digest" error, not a raw failed query.
- **Repo opt-in via `.ccx/project.toml`.** Hooks are registered globally but are inert in any repo without the toml (they resolve the project via toml only — no git fallback in the hook path). ccx stays per-repo opt-in.
- **Session identity.** Hook-created sessions are keyed by Claude Code's `session_id` (new `sessions.cc_session_id` column, unique). The MCP server keeps its own per-process session row (it has no reliable access to the CC session id). One CC session may therefore own two session rows (one hook-created, one MCP-created); the digest aggregates per-project, so this is harmless in Phase 1. Revisit if `ccx replay` friction shows up in practice.
- **Auto-verification honesty.** The TaskCompleted hook fills `verification.commit_sha` with HEAD **only when the working tree is clean**; otherwise null. `evidence_note` always states it was auto-captured. The hook records ground truth about repo state at completion time — it does not pretend HEAD proves the task's work. The drift check validates claimed SHAs mechanically.

## Decisions baked in (carried + new)

- All Phase 1 events are **append-only**. No resolution mechanism for `Question` in this plan — every posted Question is "open". Phase 2 adds resolution if calibration data shows the need.
- Drift baseline = the **last `Checkpoint` event** for the project. If no Checkpoint exists, drift is a no-op (`overclaimed_count: 0`, `note: "no checkpoint baseline"`). Do not error.
- `ccx_query` is a **raw event read**, not an aggregator. `ccx_digest` remains the single aggregated view.
- **All Node `child_process` calls use `execFileSync` with arg arrays.** No shells.
- **Artifact dedup:** one `Artifact` event per (session, repo-relative path). Repeat edits to the same file in the same session post nothing.
- **TaskCreated dedup:** if an `Intent` with the same `cc_task_id` already exists for the project, the hook posts nothing (hook may re-fire on session resume).
- **Hook payload field names are verified empirically in Task 2 before any mapping code is written.** The documented-stable common fields are `session_id`, `cwd`, `hook_event_name`; per-event fields (tool input shape, task id/subject) must be confirmed against captured samples. All per-event field access is isolated in one module (`packages/cli/src/hook-input.ts`) so corrections touch one file.

---

## File structure

```
packages/schema/
  src/events/
    intent.ts                    # MODIFY: nullable parent_plan_id + optional cc_task_id
    decision.ts                  # NEW
    question.ts                  # NEW
    human-feedback.ts            # NEW
    artifact.ts                  # NEW
    checkpoint.ts                # NEW
  tests/events/
    intent.test.ts               # MODIFY
    decision.test.ts             # NEW
    question.test.ts             # NEW
    human-feedback.test.ts       # NEW
    artifact.test.ts             # NEW
    checkpoint.test.ts           # NEW
  src/payloads.ts                # MODIFY (register 5 new validators)
  src/events/index.ts            # MODIFY (re-export)

packages/storage/
  drizzle/0001_*.sql             # NEW migration: sessions.cc_session_id
  src/
    schema.ts                    # MODIFY: cc_session_id column + unique index
    sessions.ts                  # MODIFY: ensureSessionForCc
    lookups.ts                   # NEW: latestPlanId, findIntentByCcTaskId, hasSessionArtifact
    git.ts                       # MODIFY: commitsSince, commitExists
    drift.ts                     # NEW: pure drift-check function
    digest.ts                    # MODIFY: revised Digest shape + real drift
    hook-actions.ts              # NEW: recordTaskCreated/TaskCompleted/ArtifactTouch/SessionEnd
    client.ts                    # MODIFY: connect-timeout option
    index.ts                     # MODIFY (re-exports)
  tests/
    sessions.test.ts             # MODIFY
    lookups.test.ts              # NEW
    git.test.ts                  # MODIFY
    drift.test.ts                # NEW
    digest.test.ts               # MODIFY
    hook-actions.test.ts         # NEW

packages/mcp-server/
  src/
    context.ts                   # MODIFY: retry after failed init
    tools/
      digest.ts                  # MODIFY: cwd pass-through + fail-soft message
      post-decision.ts           # NEW
      post-question.ts           # NEW
      post-human-feedback.ts     # NEW
      query.ts                   # NEW: ccx_query
      drift-check.ts             # NEW: ccx_drift_check
    server.ts                    # MODIFY: register new tools via jsonTool helper

packages/cli/
  src/
    config.ts                    # MODIFY: ~/.ccx/config.toml fallback for database URL
    project.ts                   # NEW: shared loadProject helper
    hook-input.ts                # NEW: hook stdin parsing + field mapping
    commands/
      hook.ts                    # NEW: ccx hook <event>
      blocked.ts                 # NEW
      drift.ts                   # NEW
      replay.ts                  # NEW
      projects.ts                # NEW
      digest.ts                  # MODIFY: use shared loadProject
      tail.ts                    # MODIFY: use shared loadProject
    format.ts                    # MODIFY: revised digest sections + blocked/drift/projects
    index.ts                     # MODIFY: register new commander commands
  tests/
    hook-input.test.ts           # NEW (pure)
    format.test.ts               # MODIFY

docs/
  hook-payloads.md               # NEW: captured real hook payload samples (Task 2)
```

---

## Task 1: Branch + baseline

- [ ] **Step 1: Verify Plan 1 is on master**

```bash
cd ~/repos/ccx
git checkout master
git pull
ls packages/storage/src/digest.ts            # exists (Plan 1)
ls packages/mcp-server/src/tools/post-plan.ts # exists (Plan 1)
```

- [ ] **Step 2: Branch**

```bash
git checkout -b plan-2-hooks-capture
```

- [ ] **Step 3: Build + test baseline**

```bash
pnpm install
pnpm build
pnpm test
```

All Plan 1 tests must pass. If they don't, stop and fix the regression first.

---

## Task 2: Capture real hook payloads (discovery — blocks Task 18)

The exact JSON shape of `TaskCreated`/`TaskCompleted`/`PostToolUse` hook payloads has NOT been verified against a live Claude Code install. Do not guess field names — capture them.

**Files:**
- Create: `docs/hook-payloads.md`

- [ ] **Step 1: Register a temporary logging hook**

Add to `~/.claude/settings.json` (merge into any existing `hooks` key):

```json
{
  "hooks": {
    "TaskCreated":   [{ "hooks": [{ "type": "command", "command": "cat >> ~/.ccx/hook-samples.jsonl", "timeout": 5 }] }],
    "TaskCompleted": [{ "hooks": [{ "type": "command", "command": "cat >> ~/.ccx/hook-samples.jsonl", "timeout": 5 }] }],
    "PostToolUse":   [{ "matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "cat >> ~/.ccx/hook-samples.jsonl", "timeout": 5 }] }],
    "SessionStart":  [{ "hooks": [{ "type": "command", "command": "cat >> ~/.ccx/hook-samples.jsonl", "timeout": 5 }] }],
    "SessionEnd":    [{ "hooks": [{ "type": "command", "command": "cat >> ~/.ccx/hook-samples.jsonl", "timeout": 5 }] }]
  }
}
```

```bash
mkdir -p ~/.ccx
```

- [ ] **Step 2: Generate samples**

Start a throwaway Claude Code session in any repo and prompt it: *"Create a task list with two tasks, complete the first one, and write a file called scratch.txt"*. Exit the session.

- [ ] **Step 3: Record findings**

```bash
python3 -m json.tool --json-lines < ~/.ccx/hook-samples.jsonl | less
```

Write `docs/hook-payloads.md` containing: one raw sample per hook event type, plus a table mapping the fields ccx needs → the actual JSON paths:

| ccx needs | expected path (VERIFY) |
|---|---|
| CC session id | `.session_id` |
| working dir | `.cwd` |
| event name | `.hook_event_name` |
| edited file path | `.tool_input.file_path` (Write/Edit), `.tool_input.notebook_path` (NotebookEdit) |
| tool name | `.tool_name` |
| task id | `.task.id` or `.task_id` — **confirm** |
| task subject | `.task.subject` or `.task.description` — **confirm** |

If `TaskCreated`/`TaskCompleted` events do not fire or lack a stable task id, STOP and surface it — the native-task bridge (Tasks 16, 18) needs a redesign decision, not improvisation.

- [ ] **Step 4: Remove the temporary logging hooks, commit the doc**

```bash
git add docs/hook-payloads.md
git commit -m "docs: captured hook payload samples + field map"
```

---

## Task 3: `Intent` schema — nullable parent + `cc_task_id` (TDD)

**Files:**
- Modify: `packages/schema/tests/events/intent.test.ts`
- Modify: `packages/schema/src/events/intent.ts`

- [ ] **Step 1: Add test cases (append to the existing describe block)**

```typescript
it('accepts null parent_plan_id', () => {
  const r = IntentPayloadSchema.safeParse({ parent_plan_id: null, description: 'x', ordinal: 0 });
  expect(r.success).toBe(true);
});

it('defaults parent_plan_id to null when omitted', () => {
  const r = IntentPayloadSchema.parse({ description: 'x', ordinal: 0 });
  expect(r.parent_plan_id).toBeNull();
});

it('accepts an optional cc_task_id string', () => {
  const r = IntentPayloadSchema.parse({ parent_plan_id: null, description: 'x', ordinal: 0, cc_task_id: 'task-1' });
  expect(r.cc_task_id).toBe('task-1');
});

it('rejects empty cc_task_id', () => {
  const r = IntentPayloadSchema.safeParse({ parent_plan_id: null, description: 'x', ordinal: 0, cc_task_id: '' });
  expect(r.success).toBe(false);
});
```

- [ ] **Step 2: Run to verify the new cases fail**

```bash
pnpm --filter @ccx/schema test
```

Expected: the 4 new cases FAIL (current schema requires a ULID parent and has no `cc_task_id`).

- [ ] **Step 3: Implement**

```typescript
import { z } from 'zod';
import { UlidSchema } from '../envelope.js';

export const IntentPayloadSchema = z.object({
  parent_plan_id: UlidSchema.nullable().default(null),
  description: z.string().min(1).max(500),
  ordinal: z.number().int().min(0),
  cc_task_id: z.string().min(1).optional(),
});

export type IntentPayload = z.infer<typeof IntentPayloadSchema>;
```

- [ ] **Step 4: Run tests — all pass (existing cases that posted a ULID parent still pass)**

```bash
pnpm --filter @ccx/schema test
```

- [ ] **Step 5: Commit**

```bash
git add packages/schema/
git commit -m "feat(schema): Intent allows null parent_plan_id + cc_task_id"
```

---

## Task 4: `Decision` schema (TDD)

**Files:**
- Create: `packages/schema/tests/events/decision.test.ts`
- Create: `packages/schema/src/events/decision.ts`

- [ ] **Step 1: Write the failing test** (one `describe`, one `it` per case, following the pattern of `tests/events/plan.test.ts`)

Test cases:
  - accepts a minimal Decision with no parent_plan_id and no alternatives
  - accepts a Decision with parent_plan_id (ULID) and alternatives_considered
  - rejects empty `decision`
  - rejects `decision` >300 chars
  - rejects empty `rationale`
  - rejects `rationale` >1000 chars
  - rejects non-ULID `parent_plan_id`
  - defaults `alternatives_considered` to `[]`
  - defaults `parent_plan_id` to `null`

- [ ] **Step 2: Run to verify failure, then implement**

```typescript
import { z } from 'zod';
import { UlidSchema } from '../envelope.js';

export const DecisionPayloadSchema = z.object({
  parent_plan_id: UlidSchema.nullable().default(null),
  decision: z.string().min(1).max(300),
  rationale: z.string().min(1).max(1000),
  alternatives_considered: z.array(z.string().min(1)).default([]),
});

export type DecisionPayload = z.infer<typeof DecisionPayloadSchema>;
```

- [ ] **Step 3: Test pass + commit**

```bash
pnpm --filter @ccx/schema test
git add packages/schema/
git commit -m "feat(schema): Decision payload"
```

---

## Task 5: `Question` schema (TDD)

**Files:**
- Create: `packages/schema/tests/events/question.test.ts`
- Create: `packages/schema/src/events/question.ts`

- [ ] **Step 1: Write the failing test**

Test cases:
  - accepts a minimal Question (defaults `blocks_intent_id=null`, `options_considered=[]`)
  - accepts with a ULID `blocks_intent_id` and a non-empty options list
  - rejects empty `question`
  - rejects `question` >500 chars
  - rejects non-ULID `blocks_intent_id`

- [ ] **Step 2: Implement**

```typescript
import { z } from 'zod';
import { UlidSchema } from '../envelope.js';

export const QuestionPayloadSchema = z.object({
  question: z.string().min(1).max(500),
  blocks_intent_id: UlidSchema.nullable().default(null),
  options_considered: z.array(z.string().min(1)).default([]),
});

export type QuestionPayload = z.infer<typeof QuestionPayloadSchema>;
```

- [ ] **Step 3: Test pass + commit**

```bash
pnpm --filter @ccx/schema test
git add packages/schema/
git commit -m "feat(schema): Question payload"
```

---

## Task 6: `HumanFeedback` schema (TDD)

**Files:**
- Create: `packages/schema/tests/events/human-feedback.test.ts`
- Create: `packages/schema/src/events/human-feedback.ts`

- [ ] **Step 1: Write the failing test**

Test cases:
  - accepts a valid HumanFeedback
  - rejects empty `verbatim`
  - rejects `verbatim` >2000 chars
  - rejects empty `interpreted_as`
  - rejects `interpreted_as` >500 chars

- [ ] **Step 2: Implement**

```typescript
import { z } from 'zod';

export const HumanFeedbackPayloadSchema = z.object({
  verbatim: z.string().min(1).max(2000),
  interpreted_as: z.string().min(1).max(500),
});

export type HumanFeedbackPayload = z.infer<typeof HumanFeedbackPayloadSchema>;
```

- [ ] **Step 3: Test pass + commit**

```bash
pnpm --filter @ccx/schema test
git add packages/schema/
git commit -m "feat(schema): HumanFeedback payload"
```

---

## Task 7: `Artifact` schema (TDD)

**Files:**
- Create: `packages/schema/tests/events/artifact.test.ts`
- Create: `packages/schema/src/events/artifact.ts`

- [ ] **Step 1: Write the failing test**

Test cases:
  - accepts each of `created|modified|deleted|moved` for action
  - accepts with `parent_intent_id` null (default) and with a ULID
  - rejects unknown action
  - rejects empty `path`
  - rejects `summary` >200 chars
  - rejects non-ULID `parent_intent_id`

- [ ] **Step 2: Implement**

```typescript
import { z } from 'zod';
import { UlidSchema } from '../envelope.js';

export const ArtifactActionSchema = z.enum(['created', 'modified', 'deleted', 'moved']);

export const ArtifactPayloadSchema = z.object({
  parent_intent_id: UlidSchema.nullable().default(null),
  path: z.string().min(1),
  action: ArtifactActionSchema,
  summary: z.string().min(1).max(200),
});

export type ArtifactPayload = z.infer<typeof ArtifactPayloadSchema>;
```

- [ ] **Step 3: Test pass + commit**

```bash
pnpm --filter @ccx/schema test
git add packages/schema/
git commit -m "feat(schema): Artifact payload"
```

---

## Task 8: `Checkpoint` schema (TDD)

**Files:**
- Create: `packages/schema/tests/events/checkpoint.test.ts`
- Create: `packages/schema/src/events/checkpoint.ts`

- [ ] **Step 1: Write the failing test**

Test cases:
  - accepts a fully-populated Checkpoint
  - accepts a Checkpoint with `last_test_command=null` and `last_test_exit_code=null`
  - rejects empty `git_branch`
  - rejects empty `git_commit_sha`
  - rejects `note` >300 chars
  - rejects non-integer `last_test_exit_code`
  - rejects `working_tree_clean` not a boolean

- [ ] **Step 2: Implement**

```typescript
import { z } from 'zod';

export const CheckpointPayloadSchema = z.object({
  git_branch: z.string().min(1),
  git_commit_sha: z.string().min(1),
  working_tree_clean: z.boolean(),
  last_test_command: z.string().nullable(),
  last_test_exit_code: z.number().int().nullable(),
  note: z.string().min(1).max(300),
});

export type CheckpointPayload = z.infer<typeof CheckpointPayloadSchema>;
```

- [ ] **Step 3: Test pass + commit**

```bash
pnpm --filter @ccx/schema test
git add packages/schema/
git commit -m "feat(schema): Checkpoint payload"
```

---

## Task 9: Extend payload registry + re-exports

**Files:**
- Modify: `packages/schema/src/payloads.ts`
- Modify: `packages/schema/src/events/index.ts`
- Modify: `packages/schema/tests/envelope.test.ts` (registry coverage)

- [ ] **Step 1: Add a failing registry test** (append to the existing suite)

```typescript
it.each(['Decision', 'Question', 'HumanFeedback', 'Artifact', 'Checkpoint'] as const)(
  'validatePayload has a validator for %s',
  (type) => {
    expect(() => validatePayload(type, {})).toThrow(/(Required|invalid|expected)/i);
    // Throwing a Zod error (not "No payload validator registered") proves registration.
  },
);

it('still rejects Phase-2-deferred types', () => {
  expect(() => validatePayload('Assumption', {})).toThrow(/No payload validator registered/);
});
```

- [ ] **Step 2: Register the validators**

`packages/schema/src/payloads.ts`:

```typescript
import { z } from 'zod';
import { PlanPayloadSchema } from './events/plan.js';
import { IntentPayloadSchema } from './events/intent.js';
import { IntentStatusPayloadSchema } from './events/intent-status.js';
import { DecisionPayloadSchema } from './events/decision.js';
import { QuestionPayloadSchema } from './events/question.js';
import { HumanFeedbackPayloadSchema } from './events/human-feedback.js';
import { ArtifactPayloadSchema } from './events/artifact.js';
import { CheckpointPayloadSchema } from './events/checkpoint.js';
import type { EventType } from './envelope.js';

// Phase 1 payload validators. Assumption/Discovery/Issue/Revert/PlanComplete
// are reserved names, deferred to Phase 2 (see plan-2-revised design deltas).
export const PayloadSchemaByType: Partial<Record<EventType, z.ZodTypeAny>> = {
  Plan: PlanPayloadSchema,
  Intent: IntentPayloadSchema,
  IntentStatus: IntentStatusPayloadSchema,
  Decision: DecisionPayloadSchema,
  Question: QuestionPayloadSchema,
  HumanFeedback: HumanFeedbackPayloadSchema,
  Artifact: ArtifactPayloadSchema,
  Checkpoint: CheckpointPayloadSchema,
};
```

(`validatePayload` body unchanged.)

Append to `packages/schema/src/events/index.ts` re-exports for the five new modules, matching its existing style.

- [ ] **Step 3: Test, build, commit**

```bash
pnpm --filter @ccx/schema test
pnpm --filter @ccx/schema build
git add packages/schema/
git commit -m "feat(schema): register Decision/Question/HumanFeedback/Artifact/Checkpoint"
```

---

## Task 10: `sessions.cc_session_id` migration + `ensureSessionForCc` (TDD)

**Files:**
- Modify: `packages/storage/src/schema.ts`
- Create: `packages/storage/drizzle/0001_cc_session_id.sql` (via drizzle-kit)
- Modify: `packages/storage/src/sessions.ts`
- Modify: `packages/storage/tests/sessions.test.ts`

- [ ] **Step 1: Extend the Drizzle schema**

In `packages/storage/src/schema.ts`, replace the `sessions` table definition:

```typescript
import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // ULID
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    host: text('host').notNull(),
    ccSessionId: text('cc_session_id'), // Claude Code session id (hook-created sessions)
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => ({
    ccSessionIdx: uniqueIndex('idx_sessions_cc_session').on(table.ccSessionId),
  }),
);
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm --filter @ccx/storage exec drizzle-kit generate
```

Expected SQL (verify the generated file matches in substance):

```sql
ALTER TABLE "sessions" ADD COLUMN "cc_session_id" text;
CREATE UNIQUE INDEX "idx_sessions_cc_session" ON "sessions" ("cc_session_id");
```

(Postgres unique indexes treat NULLs as distinct, so existing MCP-created sessions with null `cc_session_id` are unaffected.)

- [ ] **Step 3: Write failing tests** (append to `tests/sessions.test.ts`)

```typescript
import { ensureSessionForCc } from '../src/sessions.js';

describe('ensureSessionForCc', () => {
  it('creates a session keyed by cc_session_id', async () => {
    await ensureProject(getDb(), { id: 'sha1', name: 'p' });
    const s = await ensureSessionForCc(getDb(), {
      projectId: 'sha1', host: 'test-host', ccSessionId: 'cc-abc',
    });
    expect(s.ccSessionId).toBe('cc-abc');
    expect(s.endedAt).toBeNull();
  });

  it('returns the same session on repeat calls with the same cc_session_id', async () => {
    await ensureProject(getDb(), { id: 'sha1', name: 'p' });
    const a = await ensureSessionForCc(getDb(), { projectId: 'sha1', host: 'test-host', ccSessionId: 'cc-abc' });
    const b = await ensureSessionForCc(getDb(), { projectId: 'sha1', host: 'test-host', ccSessionId: 'cc-abc' });
    expect(b.id).toBe(a.id);
  });
});
```

- [ ] **Step 4: Implement** (append to `packages/storage/src/sessions.ts`)

```typescript
export async function ensureSessionForCc(
  db: PostgresJsDatabase<typeof schema>,
  input: { projectId: string; host: string; ccSessionId: string },
): Promise<SessionRow> {
  const [existing] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.ccSessionId, input.ccSessionId))
    .limit(1);
  if (existing) return existing;

  // Concurrent hooks may race; the unique index makes the loser a no-op.
  await db
    .insert(schema.sessions)
    .values({
      id: ulid(),
      projectId: input.projectId,
      host: input.host,
      ccSessionId: input.ccSessionId,
    })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.ccSessionId, input.ccSessionId))
    .limit(1);
  if (!row) throw new Error('ensureSessionForCc failed');
  return row;
}
```

- [ ] **Step 5: Test, apply migration to the live DB, commit**

```bash
pnpm --filter @ccx/storage test
psql "$CCX_DATABASE_URL" -f packages/storage/drizzle/0001_*.sql   # when the database host is reachable; otherwise defer to Task 23
git add packages/storage/
git commit -m "feat(storage): sessions.cc_session_id + ensureSessionForCc"
```

---

## Task 11: Lookup helpers (TDD)

**Files:**
- Create: `packages/storage/tests/lookups.test.ts`
- Create: `packages/storage/src/lookups.ts`
- Modify: `packages/storage/src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
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
```

(Note: the `findIntentByCcTaskId` "other project" assertion requires `ensureProject(getDb(), { id: 'other', name: 'o' })` in that test before querying — add it.)

- [ ] **Step 2: Implement `packages/storage/src/lookups.ts`**

```typescript
import { eq, and, desc, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import type { EventRow } from './events.js';

export async function latestPlanId(
  db: PostgresJsDatabase<typeof schema>,
  projectId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.projectId, projectId), eq(schema.events.type, 'Plan')))
    .orderBy(desc(schema.events.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function findIntentByCcTaskId(
  db: PostgresJsDatabase<typeof schema>,
  projectId: string,
  ccTaskId: string,
): Promise<EventRow | null> {
  const [row] = await db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.projectId, projectId),
        eq(schema.events.type, 'Intent'),
        sql`${schema.events.payload}->>'cc_task_id' = ${ccTaskId}`,
      ),
    )
    .orderBy(desc(schema.events.createdAt))
    .limit(1);
  return row ?? null;
}

export async function hasSessionArtifact(
  db: PostgresJsDatabase<typeof schema>,
  sessionId: string,
  path: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.sessionId, sessionId),
        eq(schema.events.type, 'Artifact'),
        sql`${schema.events.payload}->>'path' = ${path}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}
```

Append to `packages/storage/src/index.ts`:

```typescript
export * from './lookups.js';
```

- [ ] **Step 3: Test, commit**

```bash
pnpm --filter @ccx/storage test
git add packages/storage/
git commit -m "feat(storage): latestPlanId/findIntentByCcTaskId/hasSessionArtifact lookups"
```

---

## Task 12: `commitsSince` + `commitExists` git helpers (TDD)

*(Carried unchanged from the April plan.)*

**Files:**
- Modify: `packages/storage/tests/git.test.ts`
- Modify: `packages/storage/src/git.ts`

- [ ] **Step 1: Failing tests (append to git.test.ts)**

```typescript
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
// ... existing imports
import { commitsSince } from '../src/git.js';

describe('commitsSince', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeGitRepo(); });
  afterEach(() => { rmGitRepo(tmp); });

  it('returns [] when HEAD == baseline', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim();
    expect(commitsSince(tmp, head)).toEqual([]);
  });

  it('returns commits made after baseline, newest first', () => {
    const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(tmp, 'b.txt'), 'b');
    execFileSync('git', ['add', '.'], { cwd: tmp });
    execFileSync('git', ['commit', '-q', '-m', 'two'], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'c.txt'), 'c');
    execFileSync('git', ['add', '.'], { cwd: tmp });
    execFileSync('git', ['commit', '-q', '-m', 'three'], { cwd: tmp });

    const out = commitsSince(tmp, baseline);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^[0-9a-f]{40}$/);
  });

  it('throws when baseline is not a known commit', () => {
    expect(() => commitsSince(tmp, 'a'.repeat(40))).toThrow();
  });
});
```

- [ ] **Step 2: Implement (append to git.ts)**

```typescript
export function commitsSince(cwd: string, baselineSha: string): string[] {
  // Throws if baseline is unknown — useful for surfacing stale checkpoints.
  execFileSync('git', ['cat-file', '-e', `${baselineSha}^{commit}`], { cwd, stdio: 'pipe' });
  const out = git(cwd, ['log', '--format=%H', `${baselineSha}..HEAD`]).trim();
  if (out === '') return [];
  return out.split('\n');
}

export function commitExists(cwd: string, sha: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Test pass + commit**

```bash
pnpm --filter @ccx/storage test
git add packages/storage/
git commit -m "feat(storage): commitsSince + commitExists git helpers"
```

---

## Task 13: Drift check pure function (TDD)

*(Carried unchanged from the April plan — this is the anti-hubris core; it mechanically validates completion claims against git.)*

**Files:**
- Create: `packages/storage/tests/drift.test.ts`
- Create: `packages/storage/src/drift.ts`
- Modify: `packages/storage/src/index.ts`

The function takes the event stream + a `cwd` (for git checks) and returns the drift report. **It does not call git when there's no baseline checkpoint.**

- [ ] **Step 1: Failing tests**

```typescript
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
```

- [ ] **Step 2: Implement `packages/storage/src/drift.ts`**

```typescript
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
```

- [ ] **Step 3: Re-export from `packages/storage/src/index.ts`**

```typescript
export * from './drift.js';
```

- [ ] **Step 4: Test, build, commit**

```bash
pnpm --filter @ccx/storage test
pnpm --filter @ccx/storage build
git add packages/storage/
git commit -m "feat(storage): drift check against checkpoint baseline"
```

---

## Task 14: Digest revision (TDD)

Revised `Digest` shape: adds `open_questions`, `recent_decisions`, `recent_human_feedback`, `last_checkpoint`, real `drift`; open intents now include plan-less (hook-captured) intents and surface `blocked`. No `open_issues` / `unvalidated_assumptions` sections (types deferred).

**Files:**
- Modify: `packages/storage/src/digest.ts`
- Modify: `packages/storage/tests/digest.test.ts`

- [ ] **Step 1: Extend the interfaces**

In `packages/storage/src/digest.ts`:

```typescript
import type { DriftReport } from './drift.js';
import { computeDrift } from './drift.js';

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

export interface Digest {
  project_id: string;
  current_plan: DigestPlan | null;
  open_intents: DigestIntent[];            // plan intents + plan-less (hook-captured) intents
  recent_status_changes: DigestStatusChange[];
  open_questions: DigestQuestion[];
  recent_decisions: DigestDecision[];      // last 5
  recent_human_feedback: DigestHumanFeedback[]; // last 3
  last_checkpoint: DigestCheckpoint | null;
  git: GitState;
  drift: DriftReport;
}
```

- [ ] **Step 2: Update `computeDigest`**

New signature (existing call sites — MCP digest tool, CLI digest command, tests — update in this task and Tasks 19/21):

```typescript
export async function computeDigest(
  db: PostgresJsDatabase<typeof schema>,
  input: { projectId: string; git: GitState; cwd: string },
): Promise<Digest>
```

Replace the intent computation so it no longer requires a plan. Fetch all Intent rows and all IntentStatus rows once (as today), then:

```typescript
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
```

Note: the Intent and IntentStatus fetches move OUT of the `if (latestPlan)` block — hook-captured intents must appear even when no Plan exists. `current_plan` stays as today (latest Plan event or null).

Then add the new field computations:

```typescript
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
    id: r.id, decision: p.decision, rationale: p.rationale,
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
    id: r.id, verbatim: p.verbatim, interpreted_as: p.interpreted_as,
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
        git_commit_sha: string; working_tree_clean: boolean; note: string;
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
```

- [ ] **Step 3: Tests**

Update every existing `computeDigest` call in `tests/digest.test.ts` to pass `cwd` (use `makeGitRepo()` like drift.test.ts). Add:

```typescript
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
```

- [ ] **Step 4: Test, build, commit**

```bash
pnpm --filter @ccx/storage test
pnpm --filter @ccx/storage build
git add packages/storage/
git commit -m "feat(storage): revised digest — plan-less intents, questions/decisions/feedback/checkpoint, real drift"
```

Note: `@ccx/mcp-server` and `@ccx/cli` will fail to compile until Tasks 19/21 update their `computeDigest` call sites — that's expected mid-branch; run package-filtered tests until then.

---

## Task 15: Connection hardening — client timeout + config-file fallback

Hooks must not hang a Claude Code session waiting on a dead Postgres, and they run outside any shell profile so `CCX_DATABASE_URL` may be absent.

**Files:**
- Modify: `packages/storage/src/client.ts`
- Modify: `packages/cli/src/config.ts`
- Modify: `packages/cli/tests/init.test.ts` or new `packages/cli/tests/config.test.ts`

- [ ] **Step 1: `createClient` timeout option**

```typescript
export interface ClientOptions {
  connectTimeoutSeconds?: number;
}

export function createClient(url: string, opts: ClientOptions = {}): CcxClient {
  const sql: Sql = postgres(url, { max: 5, connect_timeout: opts.connectTimeoutSeconds ?? 30 });
  const db = drizzle(sql, { schema });
  return {
    db,
    async close() {
      await sql.end();
    },
  };
}
```

- [ ] **Step 2: Config fallback test (`packages/cli/tests/config.test.ts`)**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getDatabaseUrl } from '../src/config.js';

describe('getDatabaseUrl', () => {
  let tmpHome: string;
  const saved = { env: process.env.CCX_DATABASE_URL, home: process.env.HOME };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-home-'));
    process.env.HOME = tmpHome;
    delete process.env.CCX_DATABASE_URL;
  });
  afterEach(() => {
    process.env.HOME = saved.home;
    if (saved.env === undefined) delete process.env.CCX_DATABASE_URL;
    else process.env.CCX_DATABASE_URL = saved.env;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('prefers the env var', () => {
    process.env.CCX_DATABASE_URL = 'postgresql://env';
    expect(getDatabaseUrl()).toBe('postgresql://env');
  });

  it('falls back to ~/.ccx/config.toml', () => {
    fs.mkdirSync(path.join(tmpHome, '.ccx'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.ccx', 'config.toml'), 'database_url = "postgresql://file"\n');
    expect(getDatabaseUrl()).toBe('postgresql://file');
  });

  it('throws when neither exists', () => {
    expect(() => getDatabaseUrl()).toThrow(/CCX_DATABASE_URL/);
  });
});
```

- [ ] **Step 3: Implement `packages/cli/src/config.ts`**

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parse as parseToml } from 'smol-toml';

export function getDatabaseUrl(): string {
  const url = process.env.CCX_DATABASE_URL;
  if (url) return url;
  const cfgPath = path.join(os.homedir(), '.ccx', 'config.toml');
  if (fs.existsSync(cfgPath)) {
    const parsed = parseToml(fs.readFileSync(cfgPath, 'utf-8')) as { database_url?: string };
    if (parsed.database_url) return parsed.database_url;
  }
  throw new Error('CCX_DATABASE_URL is not set and ~/.ccx/config.toml has no database_url');
}
```

(`os.homedir()` reads `$HOME` on Linux, so the test's HOME swap works.)

- [ ] **Step 4: Test, commit**

```bash
pnpm --filter @ccx/storage test
pnpm --filter @ccx/cli test
git add packages/storage/ packages/cli/
git commit -m "feat: client connect timeout + ~/.ccx/config.toml database_url fallback"
```

---

## Task 16: Hook actions in storage (TDD)

The event-derivation logic hooks rely on. Lives in `@ccx/storage` so it gets real-Postgres tests; the CLI wraps it thinly.

**Files:**
- Create: `packages/storage/tests/hook-actions.test.ts`
- Create: `packages/storage/src/hook-actions.ts`
- Modify: `packages/storage/src/index.ts`

**Interfaces:**
- Consumes: `ensureSessionForCc` (Task 10), `latestPlanId`/`findIntentByCcTaskId`/`hasSessionArtifact` (Task 11), `appendEvent`, `endSession`, `GitState`.
- Produces (used by CLI Task 18): `HookSessionRef`, `recordTaskCreated(db, ref, {ccTaskId, description})`, `recordTaskCompleted(db, ref, {ccTaskId, git})`, `recordArtifactTouch(db, ref, {path, tool})`, `recordSessionEnd(db, ref, {git})` — each returns `Promise<EventRow | null>` (`null` = deliberately skipped).

- [ ] **Step 1: Failing tests**

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, truncateAll, getDb } from './helpers/test-db.js';
import { ensureProject } from '../src/projects.js';
import { appendEvent } from '../src/events.js';
import { getSession } from '../src/sessions.js';
import {
  recordTaskCreated, recordTaskCompleted, recordArtifactTouch, recordSessionEnd,
} from '../src/hook-actions.js';
import type { GitState } from '../src/git.js';

const REF = { projectId: 'sha1', host: 'test-host', ccSessionId: 'cc-1' };
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
```

- [ ] **Step 2: Implement `packages/storage/src/hook-actions.ts`**

```typescript
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { appendEvent, type EventRow } from './events.js';
import { ensureSessionForCc, endSession } from './sessions.js';
import { latestPlanId, findIntentByCcTaskId, hasSessionArtifact } from './lookups.js';
import type { GitState } from './git.js';

type Db = PostgresJsDatabase<typeof schema>;

export interface HookSessionRef {
  projectId: string;
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
```

Append to `packages/storage/src/index.ts`:

```typescript
export * from './hook-actions.js';
```

- [ ] **Step 3: Test, build, commit**

```bash
pnpm --filter @ccx/storage test
pnpm --filter @ccx/storage build
git add packages/storage/
git commit -m "feat(storage): hook actions — mechanical Intent/IntentStatus/Artifact/Checkpoint capture"
```

---

## Task 17: Shared `loadProject` helper for CLI

*(Carried from the April plan; now also consumed by the hook command.)*

**Files:**
- Create: `packages/cli/src/project.ts`
- Modify: `packages/cli/src/commands/digest.ts`
- Modify: `packages/cli/src/commands/tail.ts`

- [ ] **Step 1: Create the shared helper**

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseToml } from 'smol-toml';

export interface CliProject {
  id: string;
  name: string;
  rootDir: string; // directory containing .ccx/
}

export function loadProject(cwd: string): CliProject | null {
  let dir = path.resolve(cwd);
  while (true) {
    const candidate = path.join(dir, '.ccx', 'project.toml');
    if (fs.existsSync(candidate)) {
      const parsed = parseToml(fs.readFileSync(candidate, 'utf-8')) as {
        id: string;
        name: string;
      };
      return { id: parsed.id, name: parsed.name, rootDir: dir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireProjectOrExit(cwd: string): CliProject {
  const p = loadProject(cwd);
  if (!p) {
    process.stderr.write('No .ccx/project.toml found. Run `ccx init` first.\n');
    process.exit(1);
  }
  return p;
}
```

- [ ] **Step 2: Replace the inline copies in `digest.ts` and `tail.ts`**

Both call `requireProjectOrExit(cwd)` and use `project.id`/`project.name`/`project.rootDir`. Pass `rootDir` to `readGitState` and to `computeDigest`'s `cwd` (instead of the original `cwd`, which may be a subdirectory). `digest.ts` after the change:

```typescript
import { createClient, computeDigest, readGitState } from '@ccx/storage';
import { getDatabaseUrl } from '../config.js';
import { requireProjectOrExit } from '../project.js';
import { formatDigest } from '../format.js';

export async function runDigest(cwd: string = process.cwd()): Promise<void> {
  const project = requireProjectOrExit(cwd);
  const client = createClient(getDatabaseUrl());
  try {
    const git = readGitState(project.rootDir);
    const d = await computeDigest(client.db, { projectId: project.id, git, cwd: project.rootDir });
    process.stdout.write(formatDigest(d, project.name) + '\n');
  } finally {
    await client.close();
  }
}
```

- [ ] **Step 3: Run CLI tests, commit**

```bash
pnpm --filter @ccx/cli test
git add packages/cli/
git commit -m "refactor(cli): shared loadProject helper"
```

---

## Task 18: Hook input parsing module (TDD)

All knowledge of hook JSON shapes lives here. **Before writing this task's mapping functions, open `docs/hook-payloads.md` (Task 2) and correct the field paths below to match the captured samples.** The code below encodes the *expected* paths.

**Files:**
- Create: `packages/cli/tests/hook-input.test.ts`
- Create: `packages/cli/src/hook-input.ts`

- [ ] **Step 1: Failing tests (pure — no DB)**

```typescript
import { describe, it, expect } from 'vitest';
import { parseHookInput, toolFilePath, toolName, taskFields } from '../src/hook-input.js';

const BASE = { session_id: 'cc-1', cwd: '/repo', hook_event_name: 'PostToolUse' };

describe('parseHookInput', () => {
  it('parses the documented common fields and preserves extras', () => {
    const input = parseHookInput(JSON.stringify({ ...BASE, tool_name: 'Edit' }));
    expect(input.session_id).toBe('cc-1');
    expect(input.cwd).toBe('/repo');
  });

  it('rejects payloads missing session_id', () => {
    expect(() => parseHookInput(JSON.stringify({ cwd: '/repo', hook_event_name: 'X' }))).toThrow();
  });
});

describe('toolFilePath / toolName', () => {
  it('extracts file_path for Write/Edit and notebook_path for NotebookEdit', () => {
    const edit = parseHookInput(JSON.stringify({ ...BASE, tool_name: 'Edit', tool_input: { file_path: '/repo/src/a.ts' } }));
    expect(toolFilePath(edit)).toBe('/repo/src/a.ts');
    expect(toolName(edit)).toBe('Edit');

    const nb = parseHookInput(JSON.stringify({ ...BASE, tool_name: 'NotebookEdit', tool_input: { notebook_path: '/repo/n.ipynb' } }));
    expect(toolFilePath(nb)).toBe('/repo/n.ipynb');
  });

  it('returns null when absent', () => {
    const input = parseHookInput(JSON.stringify({ ...BASE }));
    expect(toolFilePath(input)).toBeNull();
    expect(toolName(input)).toBeNull();
  });
});

describe('taskFields', () => {
  // ADJUST the fixture below to the real TaskCreated payload from docs/hook-payloads.md.
  it('extracts task id and subject', () => {
    const input = parseHookInput(JSON.stringify({
      ...BASE, hook_event_name: 'TaskCreated', task: { id: 't1', subject: 'step one' },
    }));
    expect(taskFields(input)).toEqual({ taskId: 't1', subject: 'step one' });
  });

  it('returns null when task fields are missing', () => {
    const input = parseHookInput(JSON.stringify({ ...BASE, hook_event_name: 'TaskCreated' }));
    expect(taskFields(input)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `packages/cli/src/hook-input.ts`**

```typescript
import { z } from 'zod';

// Documented-stable common hook fields. Everything else passes through.
const HookInputSchema = z
  .object({
    session_id: z.string().min(1),
    cwd: z.string().min(1),
    hook_event_name: z.string().min(1),
  })
  .passthrough();

export type HookInput = z.infer<typeof HookInputSchema> & Record<string, unknown>;

export function parseHookInput(raw: string): HookInput {
  return HookInputSchema.parse(JSON.parse(raw)) as HookInput;
}

export async function readHookInput(stream: NodeJS.ReadableStream): Promise<HookInput> {
  let raw = '';
  stream.setEncoding('utf-8');
  for await (const chunk of stream) raw += chunk;
  return parseHookInput(raw);
}

// ---- Per-event field mapping. Paths verified against docs/hook-payloads.md. ----

export function toolName(input: HookInput): string | null {
  const t = input.tool_name;
  return typeof t === 'string' ? t : null;
}

export function toolFilePath(input: HookInput): string | null {
  const ti = input.tool_input as Record<string, unknown> | undefined;
  const p = ti?.file_path ?? ti?.notebook_path;
  return typeof p === 'string' ? p : null;
}

export function taskFields(input: HookInput): { taskId: string; subject: string } | null {
  // VERIFY against docs/hook-payloads.md — adjust paths here only.
  const task = input.task as Record<string, unknown> | undefined;
  const taskId = task?.id ?? input.task_id;
  const subject = task?.subject ?? task?.description ?? input.task_subject;
  if (typeof taskId !== 'string' || typeof subject !== 'string') return null;
  return { taskId, subject };
}
```

- [ ] **Step 3: Test, commit**

```bash
pnpm --filter @ccx/cli test
git add packages/cli/
git commit -m "feat(cli): hook input parsing + field mapping"
```

---

## Task 19: `ccx hook <event>` command

The mechanical capture entry point. **Hard rules:** always `process.exit(0)`; a repo without `.ccx/project.toml` is a silent no-op; failures append one line to `~/.ccx/hook-errors.log`; DB connect timeout 3s.

**Files:**
- Create: `packages/cli/src/commands/hook.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: `readHookInput`/`toolFilePath`/`toolName`/`taskFields` (Task 18), `loadProject` (Task 17), `createClient` + hook actions + `computeDigest` + `readGitState` (storage), `formatDigest` (format.ts), `getDatabaseUrl` (config).

- [ ] **Step 1: Implement**

```typescript
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createClient,
  computeDigest,
  readGitState,
  ensureSessionForCc,
  recordTaskCreated,
  recordTaskCompleted,
  recordArtifactTouch,
  recordSessionEnd,
  type HookSessionRef,
} from '@ccx/storage';
import { getDatabaseUrl } from '../config.js';
import { loadProject } from '../project.js';
import { readHookInput, toolFilePath, toolName, taskFields } from '../hook-input.js';
import { formatDigest } from '../format.js';

const HOOK_LOG = path.join(os.homedir(), '.ccx', 'hook-errors.log');

function logHookError(sub: string, err: unknown): void {
  try {
    fs.mkdirSync(path.dirname(HOOK_LOG), { recursive: true });
    const msg = err instanceof Error ? err.message : String(err);
    fs.appendFileSync(HOOK_LOG, `${new Date().toISOString()} ${sub}: ${msg}\n`);
  } catch {
    // Even the error log failing must not break the hook.
  }
}

export async function runHook(sub: string): Promise<void> {
  try {
    await dispatch(sub);
  } catch (err) {
    logHookError(sub, err);
  }
  // Hooks NEVER exit non-zero: a dead store must not block Claude Code.
  process.exit(0);
}

async function dispatch(sub: string): Promise<void> {
  const input = await readHookInput(process.stdin);
  const project = loadProject(input.cwd);
  if (!project) return; // not a ccx repo — hooks are inert

  const ref: HookSessionRef = {
    projectId: project.id,
    host: os.hostname(),
    ccSessionId: input.session_id,
  };
  const client = createClient(getDatabaseUrl(), { connectTimeoutSeconds: 3 });
  try {
    switch (sub) {
      case 'session-start': {
        const git = readGitState(project.rootDir);
        const d = await computeDigest(client.db, {
          projectId: project.id,
          git,
          cwd: project.rootDir,
        });
        await ensureSessionForCc(client.db, ref);
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'SessionStart',
              additionalContext:
                '## ccx digest (auto-injected at session start)\n\n' +
                formatDigest(d, project.name),
            },
          }) + '\n',
        );
        break;
      }
      case 'task-created': {
        const t = taskFields(input);
        if (t) await recordTaskCreated(client.db, ref, { ccTaskId: t.taskId, description: t.subject });
        break;
      }
      case 'task-completed': {
        const t = taskFields(input);
        if (t) {
          const git = readGitState(project.rootDir);
          await recordTaskCompleted(client.db, ref, { ccTaskId: t.taskId, git });
        }
        break;
      }
      case 'post-tool-use': {
        const filePath = toolFilePath(input);
        const tool = toolName(input);
        if (filePath && tool) {
          const rel = path.relative(project.rootDir, filePath);
          if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
            await recordArtifactTouch(client.db, ref, { path: rel, tool });
          }
        }
        break;
      }
      case 'session-end': {
        const git = readGitState(project.rootDir);
        await recordSessionEnd(client.db, ref, { git });
        break;
      }
      default:
        throw new Error(`unknown hook subcommand: ${sub}`);
    }
  } finally {
    await client.close();
  }
}
```

- [ ] **Step 2: Register in commander (`packages/cli/src/index.ts`)**

```typescript
import { runHook } from './commands/hook.js';

program
  .command('hook')
  .description('Internal: invoked by Claude Code hooks; reads hook JSON on stdin, always exits 0')
  .argument('<event>', 'session-start|session-end|task-created|task-completed|post-tool-use')
  .action(async (event: string) => {
    await runHook(event);
  });
```

- [ ] **Step 3: Build + manual fail-soft check (no DB required)**

```bash
pnpm --filter @ccx/cli build
# Not a ccx repo → silent no-op, exit 0:
echo '{"session_id":"s1","cwd":"/tmp","hook_event_name":"SessionEnd"}' | node packages/cli/dist/index.js hook session-end; echo "exit: $?"
# DB unreachable in a ccx repo → one line in ~/.ccx/hook-errors.log, exit 0:
mkdir -p /tmp/ccx-hooktest/.ccx && printf 'id = "abc"\nname = "t"\n' > /tmp/ccx-hooktest/.ccx/project.toml
CCX_DATABASE_URL='postgresql://nobody@127.0.0.1:1/ccx' sh -c 'echo "{\"session_id\":\"s1\",\"cwd\":\"/tmp/ccx-hooktest\",\"hook_event_name\":\"SessionEnd\"}" | node packages/cli/dist/index.js hook session-end'; echo "exit: $?"
tail -1 ~/.ccx/hook-errors.log
```

Expected: both runs exit 0; the second appends an error line and prints nothing to stdout.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): ccx hook command — mechanical capture entry point, fail-soft"
```

---

## Task 20: MCP fail-soft — context retry + digest message

Today a failed init poisons `getContext` forever and surfaces raw SQL to the model.

**Files:**
- Modify: `packages/mcp-server/src/context.ts`
- Modify: `packages/mcp-server/src/tools/digest.ts`

- [ ] **Step 1: Reset `initPromise` on failure**

In `getContext`, after `initPromise` is assigned, add:

```typescript
initPromise.catch(() => {
  // Allow the next tool call to retry instead of returning the same rejection forever.
  initPromise = null;
});
```

- [ ] **Step 2: Digest tool — pass cwd, structured unavailability message**

`packages/mcp-server/src/tools/digest.ts`:

```typescript
import { computeDigest, readGitState, type Digest } from '@ccx/storage';
import { getContext } from '../context.js';

export async function digest(): Promise<
  { ok: true; digest: Digest } | { ok: false; error: string }
> {
  try {
    const ctx = await getContext();
    const git = readGitState(ctx.cwd);
    const d = await computeDigest(ctx.client.db, {
      projectId: ctx.project.id,
      git,
      cwd: ctx.cwd,
    });
    return { ok: true, digest: d };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `ccx store unavailable — proceed without the digest and do not retry this session. (${detail})`,
    };
  }
}
```

- [ ] **Step 3: Build, commit**

```bash
pnpm --filter @ccx/mcp-server build
git add packages/mcp-server/
git commit -m "fix(mcp-server): retry context init after failure + fail-soft digest message"
```

---

## Task 21: Semantic MCP tools + read tools + wiring

Three model-authored write tools (`Decision`, `Question`, `HumanFeedback`) plus `ccx_query` and `ccx_drift_check`.

**Files:**
- Create: `packages/mcp-server/src/tools/post-decision.ts`
- Create: `packages/mcp-server/src/tools/post-question.ts`
- Create: `packages/mcp-server/src/tools/post-human-feedback.ts`
- Create: `packages/mcp-server/src/tools/query.ts`
- Create: `packages/mcp-server/src/tools/drift-check.ts`
- Modify: `packages/mcp-server/src/server.ts`

- [ ] **Step 1: Write tools** (each mirrors `post-plan.ts`: shape + handler returning `{ok:true,event_id}|{ok:false,error}`)

`post-decision.ts`:

```typescript
import { z } from 'zod';
import { appendEvent } from '@ccx/storage';
import { getContext } from '../context.js';

export const postDecisionInputShape = {
  decision: z.string().min(1).max(300),
  rationale: z.string().min(1).max(1000),
  alternatives_considered: z.array(z.string().min(1)).optional(),
  parent_plan_id: z.string().nullable().optional(),
} as const;

export async function postDecision(args: {
  decision: string;
  rationale: string;
  alternatives_considered?: string[];
  parent_plan_id?: string | null;
}): Promise<{ ok: true; event_id: string } | { ok: false; error: string }> {
  try {
    const ctx = await getContext();
    const ev = await appendEvent(ctx.client.db, {
      projectId: ctx.project.id,
      sessionId: ctx.session.id,
      type: 'Decision',
      payload: {
        decision: args.decision,
        rationale: args.rationale,
        alternatives_considered: args.alternatives_considered ?? [],
        parent_plan_id: args.parent_plan_id ?? null,
      },
    });
    return { ok: true, event_id: ev.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

`post-question.ts` — same pattern with:

```typescript
export const postQuestionInputShape = {
  question: z.string().min(1).max(500),
  blocks_intent_id: z.string().nullable().optional(),
  options_considered: z.array(z.string().min(1)).optional(),
} as const;
// payload: { question, blocks_intent_id: args.blocks_intent_id ?? null, options_considered: args.options_considered ?? [] }, type: 'Question'
```

`post-human-feedback.ts` — same pattern with:

```typescript
export const postHumanFeedbackInputShape = {
  verbatim: z.string().min(1).max(2000),
  interpreted_as: z.string().min(1).max(500),
} as const;
// payload: { verbatim, interpreted_as }, type: 'HumanFeedback'
```

- [ ] **Step 2: Read tools**

`query.ts`:

```typescript
import { z } from 'zod';
import { queryEvents, type EventRow } from '@ccx/storage';
import { EventTypeSchema } from '@ccx/schema';
import { getContext } from '../context.js';

export const queryInputShape = {
  type: EventTypeSchema.optional(),
  session_id: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
} as const;

export async function query(args: {
  type?: import('@ccx/schema').EventType;
  session_id?: string;
  limit?: number;
}): Promise<
  | { ok: true; events: Array<Pick<EventRow, 'id' | 'type' | 'payload'> & { created_at: string }> }
  | { ok: false; error: string }
> {
  try {
    const ctx = await getContext();
    const rows = await queryEvents(ctx.client.db, {
      projectId: ctx.project.id,
      type: args.type,
      sessionId: args.session_id,
      limit: args.limit ?? 50,
    });
    return {
      ok: true,
      events: rows.map((r) => ({
        id: r.id,
        type: r.type,
        payload: r.payload,
        created_at: r.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

`drift-check.ts`:

```typescript
import { computeDrift, type DriftReport } from '@ccx/storage';
import { getContext } from '../context.js';

export async function driftCheck(): Promise<
  { ok: true; drift: DriftReport } | { ok: false; error: string }
> {
  try {
    const ctx = await getContext();
    const drift = await computeDrift(ctx.client.db, {
      projectId: ctx.project.id,
      cwd: ctx.cwd,
    });
    return { ok: true, drift };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 3: Wire in `server.ts` with a `jsonTool` helper**

```typescript
import { z } from 'zod';
import { postDecision, postDecisionInputShape } from './tools/post-decision.js';
import { postQuestion, postQuestionInputShape } from './tools/post-question.js';
import { postHumanFeedback, postHumanFeedbackInputShape } from './tools/post-human-feedback.js';
import { query, queryInputShape } from './tools/query.js';
import { driftCheck } from './tools/drift-check.js';

function jsonTool(
  server: McpServer,
  name: string,
  description: string,
  shape: Record<string, z.ZodTypeAny>,
  handler: (args: never) => Promise<unknown>,
): void {
  server.tool(name, description, shape, async (args) => {
    const result = await handler(args as never);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });
}
```

In `buildServer()` after the existing registrations:

```typescript
jsonTool(server, 'ccx_post_decision', 'Post a Decision (durable choice future sessions would otherwise re-derive).', postDecisionInputShape, postDecision);
jsonTool(server, 'ccx_post_question', 'Post a Question. Use when stuck pending human input — then stop work.', postQuestionInputShape, postQuestion);
jsonTool(server, 'ccx_post_human_feedback', 'Post HumanFeedback (verbatim user steering/correction that matters on resume).', postHumanFeedbackInputShape, postHumanFeedback);
jsonTool(server, 'ccx_query', 'Raw event read with optional type/session_id/limit filters.', queryInputShape, query);
jsonTool(server, 'ccx_drift_check', 'Reconcile completion claims against git history since the last Checkpoint.', {}, driftCheck);
```

- [ ] **Step 4: Build + tools/list smoke**

```bash
pnpm --filter @ccx/mcp-server build
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | \
  CCX_DATABASE_URL='postgresql://nobody@127.0.0.1:1/ccx' timeout 5 node packages/mcp-server/dist/index.js
```

Expected: the tools/list response names 9 tools (`ccx_post_plan`, `ccx_post_intent`, `ccx_post_intent_status`, `ccx_digest`, `ccx_post_decision`, `ccx_post_question`, `ccx_post_human_feedback`, `ccx_query`, `ccx_drift_check`). Listing needs no DB.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/
git commit -m "feat(mcp-server): semantic write tools + ccx_query + ccx_drift_check"
```

---

## Task 22: CLI format helpers + `blocked|drift|replay|projects` commands (TDD)

**Files:**
- Modify: `packages/cli/tests/format.test.ts`
- Modify: `packages/cli/src/format.ts`
- Create: `packages/cli/src/commands/blocked.ts`
- Create: `packages/cli/src/commands/drift.ts`
- Create: `packages/cli/src/commands/replay.ts`
- Create: `packages/cli/src/commands/projects.ts`
- Modify: `packages/storage/src/projects.ts` (add `listProjects`)
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Failing format tests** (append; build Digest fixtures with the revised shape from Task 14)

```typescript
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
```

Define a local `digestFixture(overrides: Partial<Digest>): Digest` helper in the test file that fills every required field with empty defaults (`current_plan: null`, `open_intents: []`, `recent_status_changes: []`, `open_questions: []`, `recent_decisions: []`, `recent_human_feedback: []`, `last_checkpoint: null`, `git: { branch: 'main', commitSha: 'a'.repeat(40), workingTreeClean: true }`, `drift: { overclaimed_count: 0, overclaimed: [], baseline_commit_sha: null, note: 'no checkpoint baseline' }`, `project_id: 'sha1'`).

- [ ] **Step 2: Implement format helpers**

Add to `packages/cli/src/format.ts`:

```typescript
import type { Digest, DriftReport, ProjectRow, EventRow } from '@ccx/storage';

export function formatBlocked(d: Digest): string {
  const lines: string[] = ['# ccx blocked', ''];
  lines.push('## Open Questions');
  if (d.open_questions.length === 0) lines.push('_none_');
  else for (const q of d.open_questions) {
    const blocks = q.blocks_intent_id ? ` (blocks ${q.blocks_intent_id})` : '';
    lines.push(`- ${q.created_at} [${q.id}]${blocks} — ${q.question}`);
  }
  lines.push('', '## Blocked Intents');
  const blockedIntents = d.open_intents.filter((i) => i.status === 'blocked');
  if (blockedIntents.length === 0) lines.push('_none_');
  else for (const i of blockedIntents) {
    lines.push(`- ${i.ordinal}. [${i.id}] ${i.description}`);
  }
  return lines.join('\n');
}

export function formatDrift(d: DriftReport): string {
  const lines: string[] = ['# ccx drift', ''];
  if (d.note) lines.push(`_${d.note}_`);
  lines.push(`Baseline checkpoint: ${d.baseline_commit_sha ?? '<none>'}`, '');
  if (d.overclaimed_count === 0) {
    lines.push('No overclaiming detected.');
  } else {
    lines.push(`OVERCLAIMED: ${d.overclaimed_count}`);
    for (const o of d.overclaimed) {
      lines.push(`- intent ${o.intent_id} claimed ${o.claimed_commit_sha} — ${o.reason}`);
    }
  }
  return lines.join('\n');
}

export function formatProjects(rows: ProjectRow[]): string {
  if (rows.length === 0) return '_no projects_';
  return rows
    .map((r) => `${r.name.padEnd(30)}  ${r.id}  (created ${r.createdAt.toISOString()})`)
    .join('\n');
}
```

(`ProjectRow` must be exported from `@ccx/storage` — it already is via `projects.ts`; verify.)

Extend `formatDigest` — insert after the "Recent Status Changes" section and before "Git State":

```typescript
lines.push('## Open Questions');
if (d.open_questions.length === 0) lines.push('_none_');
else for (const q of d.open_questions) lines.push(`- [${q.id}] ${q.question}`);
lines.push('');

lines.push('## Recent Decisions');
if (d.recent_decisions.length === 0) lines.push('_none_');
else for (const dec of d.recent_decisions) lines.push(`- [${dec.id}] ${dec.decision} — ${dec.rationale}`);
lines.push('');

lines.push('## Recent Human Feedback');
if (d.recent_human_feedback.length === 0) lines.push('_none_');
else for (const h of d.recent_human_feedback) lines.push(`- "${h.verbatim}" → ${h.interpreted_as}`);
lines.push('');

lines.push('## Last Checkpoint');
if (d.last_checkpoint) {
  lines.push(`- ${d.last_checkpoint.created_at} @ ${d.last_checkpoint.git_commit_sha.slice(0, 12)} (${d.last_checkpoint.working_tree_clean ? 'clean' : 'dirty'}) — ${d.last_checkpoint.note}`);
} else {
  lines.push('_none_');
}
lines.push('');
```

And replace the Drift section body:

```typescript
lines.push('## Drift');
if (d.drift.note) lines.push(`_${d.drift.note}_`);
lines.push(`- Overclaimed completions: ${d.drift.overclaimed_count}`);
for (const o of d.drift.overclaimed) {
  lines.push(`  - intent ${o.intent_id} claimed ${o.claimed_commit_sha} — ${o.reason}`);
}
```

- [ ] **Step 3: Commands**

`blocked.ts`:

```typescript
import { createClient, computeDigest, readGitState } from '@ccx/storage';
import { getDatabaseUrl } from '../config.js';
import { requireProjectOrExit } from '../project.js';
import { formatBlocked } from '../format.js';

export async function runBlocked(cwd: string = process.cwd()): Promise<void> {
  const project = requireProjectOrExit(cwd);
  const client = createClient(getDatabaseUrl());
  try {
    const git = readGitState(project.rootDir);
    const d = await computeDigest(client.db, { projectId: project.id, git, cwd: project.rootDir });
    process.stdout.write(formatBlocked(d) + '\n');
  } finally {
    await client.close();
  }
}
```

`drift.ts`:

```typescript
import { createClient, computeDrift } from '@ccx/storage';
import { getDatabaseUrl } from '../config.js';
import { requireProjectOrExit } from '../project.js';
import { formatDrift } from '../format.js';

export async function runDrift(cwd: string = process.cwd()): Promise<void> {
  const project = requireProjectOrExit(cwd);
  const client = createClient(getDatabaseUrl());
  try {
    const d = await computeDrift(client.db, { projectId: project.id, cwd: project.rootDir });
    process.stdout.write(formatDrift(d) + '\n');
    if (d.overclaimed_count > 0) process.exitCode = 2; // non-zero exit when drift detected
  } finally {
    await client.close();
  }
}
```

`replay.ts`:

```typescript
import { createClient, queryEvents } from '@ccx/storage';
import { getDatabaseUrl } from '../config.js';
import { requireProjectOrExit } from '../project.js';
import { formatTail } from '../format.js';

export async function runReplay(sessionId: string, cwd: string = process.cwd()): Promise<void> {
  const project = requireProjectOrExit(cwd);
  const client = createClient(getDatabaseUrl());
  try {
    // queryEvents orders newest-first; replay wants oldest-first.
    const events = (await queryEvents(client.db, {
      projectId: project.id, sessionId, limit: 10_000,
    })).slice().reverse();
    process.stdout.write(formatTail(events) + '\n');
  } finally {
    await client.close();
  }
}
```

`projects.ts` command + storage helper — append to `packages/storage/src/projects.ts`:

```typescript
export async function listProjects(
  db: PostgresJsDatabase<typeof schema>,
): Promise<ProjectRow[]> {
  return db.select().from(schema.projects).orderBy(schema.projects.name);
}
```

`packages/cli/src/commands/projects.ts`:

```typescript
import { createClient, listProjects } from '@ccx/storage';
import { getDatabaseUrl } from '../config.js';
import { formatProjects } from '../format.js';

export async function runProjects(): Promise<void> {
  const client = createClient(getDatabaseUrl());
  try {
    const rows = await listProjects(client.db);
    process.stdout.write(formatProjects(rows) + '\n');
  } finally {
    await client.close();
  }
}
```

- [ ] **Step 4: Wire commander** (append to `packages/cli/src/index.ts`, matching the existing try/catch style)

```typescript
import { runBlocked } from './commands/blocked.js';
import { runDrift } from './commands/drift.js';
import { runReplay } from './commands/replay.js';
import { runProjects } from './commands/projects.js';

program
  .command('blocked')
  .description('Print open Questions and blocked Intents for the current project')
  .action(async () => {
    try { await runBlocked(); }
    catch (err) {
      process.stderr.write(`ccx blocked failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('drift')
  .description('Reconcile completion claims against git since the last Checkpoint. Exits 2 if drift detected.')
  .action(async () => {
    try { await runDrift(); }
    catch (err) {
      process.stderr.write(`ccx drift failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('replay')
  .description('Print the full event stream for a session, oldest first')
  .argument('<session_id>', 'session ULID')
  .action(async (sessionId: string) => {
    try { await runReplay(sessionId); }
    catch (err) {
      process.stderr.write(`ccx replay failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('projects')
  .description('List all projects in the database')
  .action(async () => {
    try { await runProjects(); }
    catch (err) {
      process.stderr.write(`ccx projects failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });
```

- [ ] **Step 5: Test, build, smoke, commit**

```bash
pnpm --filter @ccx/storage build
pnpm --filter @ccx/cli test
pnpm --filter @ccx/cli build
node packages/cli/dist/index.js --help   # 8 commands: init digest tail hook blocked drift replay projects
git add packages/storage/ packages/cli/
git commit -m "feat(cli): blocked/drift/replay/projects + revised digest rendering"
```

---

## Task 23: Register the hooks on a workstation + live verification

**Files:**
- Modify: `~/.claude/settings.json` (global Claude Code state — not committed)
- Create: `~/.ccx/config.toml`

- [ ] **Step 1: Write `~/.ccx/config.toml`** with the same URL the MCP registration uses (hooks don't inherit `~/.claude.json` env):

```toml
database_url = "postgresql://<user>:<pass>@db.example.lan:5433/ccx"
```

```bash
chmod 600 ~/.ccx/config.toml
```

- [ ] **Step 2: Apply outstanding migrations** (requires the database host reachable — if still down, STOP this task and continue with Task 24; return here before Task 25):

```bash
psql "$(python3 -c "import tomllib;print(tomllib.load(open('~/.ccx/config.toml','rb'))['database_url'])")" -f packages/storage/drizzle/0001_*.sql
```

- [ ] **Step 3: Merge into `~/.claude/settings.json`** (event names were confirmed working in Task 2; `timeout` is seconds):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node <repo>/packages/cli/dist/index.js hook session-start", "timeout": 10 }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "node <repo>/packages/cli/dist/index.js hook session-end", "timeout": 10 }] }
    ],
    "TaskCreated": [
      { "hooks": [{ "type": "command", "command": "node <repo>/packages/cli/dist/index.js hook task-created", "timeout": 10 }] }
    ],
    "TaskCompleted": [
      { "hooks": [{ "type": "command", "command": "node <repo>/packages/cli/dist/index.js hook task-completed", "timeout": 10 }] }
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "node <repo>/packages/cli/dist/index.js hook post-tool-use", "timeout": 10 }] }
    ]
  }
}
```

- [ ] **Step 4: Live verification**

1. `cd ~/repos/ccx && node packages/cli/dist/index.js init` (creates `.ccx/project.toml` for this repo if absent).
2. Start a fresh Claude Code session in `~/repos/ccx`. Confirm the injected "ccx digest (auto-injected at session start)" block appears in context (ask the session: "what does the ccx digest say?").
3. In that session, have it create + complete a task and write a scratch file. Exit.
4. `node packages/cli/dist/index.js tail -n 10` — expect an `Intent`, an `IntentStatus(completed)` with an `auto:` evidence note, an `Artifact`, and a `Checkpoint(auto: session end)`.
5. Start a session in a repo WITHOUT `.ccx/` — confirm zero ccx noise and `~/.ccx/hook-errors.log` gains nothing.
6. Stop Postgres access (or test while the database host is down): session start must proceed normally with no injected digest and one error line in the log.

---

## Task 24: Rewrite the global CLAUDE.md guidance

Capture is mechanical now; the model-facing instructions shrink to the semantic tier.

**Files:**
- Modify: `~/.claude/CLAUDE.md` (not committed to this repo)

- [ ] **Step 1: Replace the "ccx Event Log (Phase 1)" section with:**

```markdown
## ccx Event Log

Repos with `.ccx/project.toml` use ccx. The resume digest is injected
automatically at session start (SessionStart hook) — read it before reading
source files; address open intents and drift before new work. If no digest
block appears, the store is down: proceed normally, do not try to fetch it.

Mechanical capture is automatic (hooks record native task create/complete,
file edits, and a session-end checkpoint). Do NOT post events for those.

Post only what hooks cannot know:

- `ccx_post_plan` + `ccx_post_intent` when the user agrees to a multi-step
  plan (native TaskCreate is also captured — prefer native tasks; use these
  only for plan structure the task list doesn't carry).
- `ccx_post_intent_status` only to mark `blocked`/`abandoned` (with reason),
  or a manual `completed` with REAL verification (commit SHA if code changed,
  test command + exit code if tests ran; never invented — a false completion
  claim is worse than no claim).
- `ccx_post_decision` for choices future sessions would otherwise re-derive.
- `ccx_post_question` when stuck pending human input — then stop work.
- `ccx_post_human_feedback` when the user steers or corrects in a way that
  matters on resume.

Mid-session recall: `ccx_query` (raw events), `ccx_digest` (fresh digest),
`ccx_drift_check` (verify completion claims against git).

Do not retroactively post events for earlier turns — append-only.
```

- [ ] **Step 2: No git commit — global Claude Code state.**

---

## Task 25: End-to-end smoke test

Manual, against real Postgres (database host reachable). Exercises the hook path via piped stdin — no live Claude Code needed — plus the MCP semantic tools and the drift positive case.

- [ ] **Step 1: Fresh scratch repo**

```bash
rm -rf /tmp/ccx-smoke && mkdir /tmp/ccx-smoke && cd /tmp/ccx-smoke
git init -q && git commit -q --allow-empty -m init
node ~/repos/ccx/packages/cli/dist/index.js init
```

- [ ] **Step 2: Simulate the hook sequence** (adjust the task/tool field names to match `docs/hook-payloads.md`):

```bash
CLI=~/repos/ccx/packages/cli/dist/index.js
echo '{"session_id":"smoke-cc-1","cwd":"/tmp/ccx-smoke","hook_event_name":"SessionStart"}' | node $CLI hook session-start
echo '{"session_id":"smoke-cc-1","cwd":"/tmp/ccx-smoke","hook_event_name":"TaskCreated","task":{"id":"t1","subject":"build the widget"}}' | node $CLI hook task-created
echo '{"session_id":"smoke-cc-1","cwd":"/tmp/ccx-smoke","hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/ccx-smoke/widget.ts"}}' | node $CLI hook post-tool-use
echo '{"session_id":"smoke-cc-1","cwd":"/tmp/ccx-smoke","hook_event_name":"TaskCompleted","task":{"id":"t1","subject":"build the widget"}}' | node $CLI hook task-completed
echo '{"session_id":"smoke-cc-1","cwd":"/tmp/ccx-smoke","hook_event_name":"SessionEnd"}' | node $CLI hook session-end
node $CLI tail -n 10
```

Expected in the tail: `Intent` (cc_task_id t1) → `Artifact` (widget.ts) → `IntentStatus` completed with `auto:` evidence (tree clean → commit sha present) → `Checkpoint` (auto: session end). The session-start invocation printed a `hookSpecificOutput` JSON blob.

- [ ] **Step 3: Semantic MCP tools + drift positive case**

Post a Decision, a Question, and a fake-SHA completion via the MCP server's stdio JSON-RPC (same two-pass technique as Plan 1's smoke: capture the Intent id from the first pass, then claim `"commit_sha": "dddd…"` in an `ccx_post_intent_status` call). Then:

```bash
cd /tmp/ccx-smoke
node $CLI digest    # all sections render; drift shows the fake claim
node $CLI blocked   # shows the Question
node $CLI drift; echo "exit: $?"   # OVERCLAIMED: 1, exit 2
node $CLI projects  # lists ccx-smoke
```

- [ ] **Step 4: No commit — manual verification step.**

---

## Task 26: README + full suite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Replace `## Status` with:

```markdown
## Status

Phase 1 revised (hooks-based capture): mechanical events (Intent/IntentStatus
via native-task bridge, Artifact, Checkpoint, digest injection) are posted by
Claude Code hooks calling `ccx hook <event>`; semantic events
(Plan/Decision/Question/HumanFeedback) post via MCP. Drift check reconciles
completion claims against git. Assumption/Discovery/Issue/Revert/PlanComplete
are deferred to Phase 2. Plan 3 adds the SQLite local fallback.
See docs/plans/2026-07-13-phase-1-plan-2-revised-hooks-capture.md.
```

Append to Quick start: the hooks registration step (reference Task 23's settings.json block), `~/.ccx/config.toml`, and the new CLI commands (`blocked`, `drift`, `replay <session_id>`, `projects`, `hook <event>`).

- [ ] **Step 2: Full suite**

```bash
pnpm test
pnpm typecheck
pnpm build
```

All green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: phase 1 revised — hooks-based capture"
```

---

## Task 27: Open the PR

- [ ] **Step 1: Check for an existing PR, then push**

```bash
gh pr list --author @me --state open
git push -u origin plan-2-hooks-capture
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base master --title "Phase 1 Plan 2 (revised): hooks-based capture + read tools" --body "$(cat <<'EOF'
## Summary
- Capture shifted from voluntary (CLAUDE.md prose) to mechanical (Claude Code hooks): `ccx hook session-start|session-end|task-created|task-completed|post-tool-use`
- Native-task bridge: TaskCreated/TaskCompleted → Intent/IntentStatus with honest auto-verification from git state
- SessionStart hook injects the digest into context (replaces "call ccx_digest first")
- Fail-soft everywhere: hooks always exit 0, MCP digest returns a structured store-unavailable message, 3s connect timeout, ~/.ccx/config.toml URL fallback
- Real drift check (commit existence + post-baseline range) wired into digest, `ccx drift` (exit 2 on drift), and `ccx_drift_check`
- Semantic MCP surface: ccx_post_decision / ccx_post_question / ccx_post_human_feedback + ccx_query
- New schemas: Decision, Question, HumanFeedback, Artifact, Checkpoint; Intent gains nullable parent + cc_task_id; sessions gain cc_session_id
- CLI: blocked / drift / replay / projects
- Deferred to Phase 2: Assumption, Discovery, Issue, Revert, PlanComplete

Supersedes docs/plans/2026-04-25-phase-1-plan-2-event-types-and-read-tools.md.

## Test plan
- [x] pnpm test (unit + integration via testcontainers)
- [x] Hook sequence simulated via stdin produces Intent → Artifact → IntentStatus(auto) → Checkpoint
- [x] Hooks are inert in non-ccx repos and exit 0 with Postgres down
- [x] ccx drift flags a fake commit_sha claim and exits 2
- [x] Live Claude Code session on a workstation: digest injected at start, task bridge + artifact + checkpoint captured

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Merge once green**

```bash
gh pr merge --squash --delete-branch
```

---

## Definition of Done (Plan 2 revised)

- [ ] All tasks committed on branch `plan-2-hooks-capture`
- [ ] `pnpm test` / `pnpm typecheck` / `pnpm build` green
- [ ] Hook payload field map verified against real captures (`docs/hook-payloads.md`) before any mapping code merged
- [ ] Hooks: inert without `.ccx/project.toml`; always exit 0; DB-down leaves one log line and zero session disruption
- [ ] SessionStart digest injection observed in a live Claude Code session on a workstation
- [ ] Native-task bridge observed live: TaskCreated → Intent, TaskCompleted → IntentStatus with `auto:` evidence
- [ ] Drift check flags a fabricated commit SHA (`ccx drift` exits 2; digest shows it)
- [ ] MCP surface: 9 tools (3 existing writes + digest + 3 semantic writes + query + drift_check)
- [ ] CLI: `init|digest|tail|hook|blocked|drift|replay|projects` functional
- [ ] Global CLAUDE.md rewritten to the semantic-only guidance
- [ ] PR opened and merged

Remaining Phase 1 gap after this plan: SQLite local fallback + offline spool (Plan 3). Until then, DB-down means hook events are dropped (logged, fail-soft) — accepted.

---

## Notes for the executing agent

- **`execFileSync('git', [args], opts)` only. No shells.** Same rule as Plan 1.
- **Task 2 is a hard gate for Task 18.** If captured payloads contradict the expected field paths, fix `hook-input.ts` (one file) and its test fixtures — nothing else should need touching.
- **Fail-soft is non-negotiable in `ccx hook`.** No code path may `process.exit(1)` or let an exception escape. If you find one, that's a bug.
- **Mid-branch compile breakage is expected** between Task 14 (digest signature change) and Tasks 19–22 (call-site updates). Use `pnpm --filter` per package until Task 22, then the full suite must be green.
- **Do not add SQLite, HTTP transport, or Phase-2 event types.** Plan 3+ work.
- **Drift baseline rule:** no Checkpoint → `overclaimed_count: 0` with a note. Do not error.
- **Performance check:** digest against a project with 200+ events must return <500ms; if not, the unbounded reads are the suspects — bound them and add a `_truncated` note.
- **If you hit a blocker for >2 attempts on the same step, stop and surface it** (global CLAUDE.md §6).
