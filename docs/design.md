# Handoff: `ccx` — Claude Code Event Log & Resume System

**Author:** Gary (design session via claude.ai)
**Target:** Claude Code CLI (execution mode)
**Status:** Phase 1 spec, ready for build. Phase 2 sketched.

---

## Problem Statement

Working across multiple Claude Code sessions in parallel produces three recurring failure modes:

1. **Cognitive desync.** After context-switching between repos (or between Claude Code and life), the human loses the mental model of where the agent is in its plan. Re-reading scrollback is slow and unreliable.
2. **SSH disconnects.** A dropped session leaves no canonical record of what the agent had completed vs. claimed vs. attempted. On reconnect, the agent's self-summary is a fresh hallucination, not a query against ground truth.
3. **Disputes about completion.** "I already did that" / "no you didn't" arguments waste turns. Self-reported summaries (the prior `Session.md` approach) drift in format and have no verification against git/test state.

The prior `Session.md` system failed because it was free-form prose authored by the agent, with no schema, no verification, and no resume-time digest. Reading it on resume was no faster than asking for a fresh summary.

## Design Decisions

### D1: Typed event log, hard schema, server-validated

Events are append-only, typed records with strict per-type payload schemas. Validation happens server-side; bad payloads are rejected. This is the explicit lesson from `Session.md`: prose drifts, schemas don't.

### D2: Hierarchical event model with stable IDs

```
Plan
 ├── Intent (parent_plan_id)
 │    └── IntentStatus events (started/completed/blocked/abandoned)
 ├── Decision (parent_plan_id)
 ├── Assumption
 ├── Discovery
 ├── Issue
 ├── Question (parent_plan_id, blocks an intent_id optionally)
 ├── Artifact (file touched, with parent_intent_id)
 ├── Revert
 ├── HumanFeedback (verbatim capture of human steering)
 └── Checkpoint (git SHA + test state snapshot)
```

Every event has: `id` (ULID), `project_id`, `session_id`, `created_at`, `type`, `payload` (typed JSON). Parent references are foreign keys, not embedded.

`IntentStatus` is **not** a separate event type per state transition — it's one event type carrying `intent_id` and `status` enum. This avoids combinatorial explosion as we add states.

### D3: Project ID is first-commit SHA, not remote URL

Remote URLs are fragile (rename, fork, HTTPS↔SSH). First-commit SHA is immutable, survives renames and remote changes, and distinguishes forks. A `.ccx/project.toml` file in the repo holds the canonical ID plus a human-readable name.

### D4: Verification, not trust

`IntentStatus(completed)` events MUST carry a `verification` field:

```json
{
  "intent_id": "01JABC...",
  "status": "completed",
  "verification": {
    "commit_sha": "abc123...",   // optional, required if intent produced code
    "test_command": "pnpm test",  // optional
    "test_exit_code": 0,          // required if test_command present
    "evidence_note": "..."        // free-form, ≤200 chars
  }
}
```

Resume digest reconciles the event log against actual git state and surfaces drift loudly: *"Event log claims 3 intents completed since `abc123`; git shows 1 commit since then. Suspect overclaiming."*

### D5: MCP for the agent, CLI for the human, HTTP later

Three integration surfaces were considered:

- **MCP server (chosen for agent path).** Claude Code is built around MCP. Tool calls are stdio-local — single-digit ms — versus 50–150ms for a CLI process spawn per event. Schema validation happens at the tool boundary. The agent sees typed tools with descriptions and never has to construct shell-safe command lines or JSON payloads as strings. Failure modes are clean: tool error → structured error → agent can retry or escalate.
- **CLI (kept for human path).** Worse for the agent (process-spawn overhead, shell quoting hazards), fine for humans running `ccx digest`, `ccx tail`, `ccx blocked` from a terminal. Same backing store; different ergonomics.
- **REST/HTTP API (deferred).** Worst of both for the agent — adds a network hop, more HTTP-construction failure surface, no benefit since agent and MCP server share a host. Worth adding later for web dashboards, Slack bots, or third-party integrations. The MCP server can grow an HTTP listener alongside its stdio interface when needed.

### D6: Postgres on a shared host, SQLite local fallback

Single source of truth on a shared database host (reuse the existing Postgres or stand up a dedicated `ccx` database). All workstations write to it. If the database host is unreachable, the MCP server writes to local SQLite at `~/.ccx/local.db` and queues a sync job. On reconnect, queued events flush to Postgres in original `created_at` order.

### D7: Agent can read its own log mid-session

Phase 1 supports both write (event posting) and read (`ccx_query`, `ccx_digest`) tools. This lets the agent answer "what did we decide about the auth provider yesterday?" without burning context window on scrollback.

### D8: Resume = computed digest, not raw log

Raw events are truth; the resume context is a **derived view**. The bootstrap prompt fed to a fresh Claude Code session contains:

- Current plan summary (latest `Plan` event in active state)
- Open intents with status
- Unresolved questions and blocked intents
- Recent decisions (last 5)
- Active assumptions
- Last 3 artifacts touched
- Git/test reconciliation: "branch X, commit Y, working tree clean/dirty, last test run Z."

Not the raw event stream.

### D9: MCP server registered globally, not per-project

The MCP server is installed once per workstation and registered in `~/.claude.json` (or equivalent global Claude Code config). Project resolution happens server-side: on each tool call, the server reads `.ccx/project.toml` from the current working directory (or computes the first-commit SHA if absent and `ccx init` hasn't been run). This avoids per-project `.mcp.json` files and keeps the integration invisible at the repo level beyond `.ccx/`.

### D10: Calibration over completeness

The agent is instructed to use the event log as a tool of judgment, not a checklist. The CLAUDE.md framing leads with "would a fresh instance need this?" rather than "post one of these per turn." A noisy log is worse than no log — it re-creates the digest-fatigue problem that killed Session.md.

---

## Architecture

```
┌─────────────────────────┐     ┌─────────────────────────┐
│ Claude Code (host A)    │     │ Claude Code (host B)    │
│  - posts events via MCP │     │  - posts events via MCP │
└──────────┬──────────────┘     └──────────┬──────────────┘
           │ stdio MCP                     │ stdio MCP
           ▼                                ▼
┌─────────────────────────────────────────────────────┐
│  ccx-mcp-server (one process per CC instance)       │
│  - validates payloads                                │
│  - resolves project_id from .ccx/project.toml + git │
│  - writes to Postgres OR local SQLite (fallback)    │
└──────────┬──────────────────────────────────────────┘
           │ pg / queued sync
           ▼
┌─────────────────────────────────────────────────────┐
│  Postgres on the db host (db: ccx)                   │
│  - events (append-only)                              │
│  - projects                                          │
│  - sessions                                          │
│  - materialized views for digest                     │
└──────────┬──────────────────────────────────────────┘
           │ read
           ▼
┌─────────────────────────────────────────────────────┐
│  ccx CLI (any workstation)                           │
│  - ccx tail / digest / blocked / replay / drift      │
└─────────────────────────────────────────────────────┘
```

---

## Event Type Schemas (Phase 1)

All events share a common envelope:

```json
{
  "id": "01J...",                    // ULID, server-assigned
  "project_id": "first-commit-sha",
  "session_id": "01J...",            // ULID per CC instance
  "type": "Plan|Intent|...",
  "created_at": "2026-04-25T...",
  "payload": { ... }                  // type-specific, see below
}
```

### `Plan`
Replaces any prior active plan for this project unless `supersedes` is null.
```json
{
  "title": "string, ≤100 chars",
  "summary": "string, ≤2000 chars",
  "supersedes": "plan_event_id | null"
}
```

### `Intent`
```json
{
  "parent_plan_id": "plan_event_id",
  "description": "string, ≤500 chars",
  "ordinal": "integer, position in plan"
}
```

### `IntentStatus`
```json
{
  "intent_id": "intent_event_id",
  "status": "started|completed|blocked|abandoned",
  "verification": {                 // required when status=completed
    "commit_sha": "string | null",
    "test_command": "string | null",
    "test_exit_code": "integer | null",
    "evidence_note": "string, ≤200 chars"
  },
  "reason": "string, ≤500 chars"    // required when blocked|abandoned
}
```

### `Decision`
```json
{
  "parent_plan_id": "plan_event_id | null",
  "decision": "string, ≤300 chars",
  "rationale": "string, ≤1000 chars",
  "alternatives_considered": ["string", ...]
}
```

### `Assumption`
```json
{
  "assumption": "string, ≤300 chars",
  "confidence": "low|medium|high",
  "validated": "boolean, default false"
}
```

### `Discovery`
Non-issue facts learned about the codebase or environment.
```json
{
  "fact": "string, ≤500 chars",
  "scope": "repo|env|external"
}
```

### `Issue`
```json
{
  "summary": "string, ≤200 chars",
  "detail": "string, ≤2000 chars",
  "severity": "low|medium|high|critical",
  "blocks_intent_id": "intent_event_id | null"
}
```

### `Question`
Agent is stuck pending human input.
```json
{
  "question": "string, ≤500 chars",
  "blocks_intent_id": "intent_event_id | null",
  "options_considered": ["string", ...]
}
```

### `Artifact`
File touched in service of an intent.
```json
{
  "parent_intent_id": "intent_event_id | null",
  "path": "string, repo-relative",
  "action": "created|modified|deleted|moved",
  "summary": "string, ≤200 chars"
}
```

### `Revert`
```json
{
  "what": "string, ≤300 chars",
  "why": "string, ≤500 chars",
  "commit_sha_reverted": "string | null"
}
```

### `HumanFeedback`
Verbatim capture of human steering — critical for resume context.
```json
{
  "verbatim": "string, ≤2000 chars",
  "interpreted_as": "string, ≤500 chars"
}
```

### `Checkpoint`
Explicit ground-truth snapshot.
```json
{
  "git_branch": "string",
  "git_commit_sha": "string",
  "working_tree_clean": "boolean",
  "last_test_command": "string | null",
  "last_test_exit_code": "integer | null",
  "note": "string, ≤300 chars"
}
```

### `PlanComplete`
```json
{
  "plan_id": "plan_event_id",
  "summary": "string, ≤2000 chars",
  "recommendations": ["string", ...]
}
```

---

## MCP Tool Surface (Phase 1)

Tools exposed by `ccx-mcp-server`. All return `{ ok: true, event_id }` or `{ ok: false, error }`.

**Write tools (one per event type):**
- `ccx_post_plan(title, summary, supersedes?)`
- `ccx_post_intent(parent_plan_id, description, ordinal)`
- `ccx_post_intent_status(intent_id, status, verification?, reason?)`
- `ccx_post_decision(decision, rationale, alternatives_considered?, parent_plan_id?)`
- `ccx_post_assumption(assumption, confidence, validated?)`
- `ccx_post_discovery(fact, scope)`
- `ccx_post_issue(summary, detail, severity, blocks_intent_id?)`
- `ccx_post_question(question, blocks_intent_id?, options_considered?)`
- `ccx_post_artifact(path, action, summary, parent_intent_id?)`
- `ccx_post_revert(what, why, commit_sha_reverted?)`
- `ccx_post_human_feedback(verbatim, interpreted_as)`
- `ccx_post_checkpoint(...)`  // server auto-fills git fields if not provided
- `ccx_post_plan_complete(plan_id, summary, recommendations?)`

**Read tools:**
- `ccx_digest()` → derived resume view (current plan, open intents, blocks, recent decisions, drift report)
- `ccx_query(filter)` → raw events matching filter (type, since, parent_id, limit)
- `ccx_drift_check()` → reconcile event log against current git state, return discrepancies

## CLI Surface (Phase 1)

```bash
ccx init                    # writes .ccx/project.toml using first-commit SHA
ccx digest                  # human-readable resume view
ccx tail [-n 20]            # last N events, newest first
ccx blocked                 # open Questions and blocked intents
ccx drift                   # alias for ccx_drift_check
ccx replay <session_id>     # full event stream for a session
ccx projects                # list all known projects
```

---

## Storage Schema (Postgres)

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,              -- first-commit SHA
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- ULID
  project_id TEXT REFERENCES projects(id),
  host TEXT NOT NULL,               -- e.g. workstation-1, laptop-2
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,              -- ULID
  project_id TEXT NOT NULL REFERENCES projects(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_project_created ON events(project_id, created_at DESC);
CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_events_type ON events(project_id, type);
CREATE INDEX idx_events_payload_gin ON events USING gin (payload);
```

Materialized view for digest is acceptable but not required for Phase 1; `ccx_digest()` can compute on read with the indexes above.

---

## Implementation Plan

1. **Schema + migrations** — Drizzle migration for the three tables. Reuse an existing Postgres on the database host if available; otherwise stand up a `ccx` database.
2. **MCP server** — TypeScript, stdio transport. Single binary distributed via npm or Go binary. Validates payloads with Zod. Resolves `project_id` by reading `.ccx/project.toml`, falling back to computing first-commit SHA via `git rev-list --max-parents=0 HEAD`. Registered globally in `~/.claude.json`, not per-project `.mcp.json`.
3. **Local SQLite fallback** — same schema; sync worker pushes queued events to Postgres on reconnect, in `created_at` order.
4. **CLI** — thin wrapper over the same store layer. Read-only commands plus `ccx init`.
5. **Digest logic** — pure function over event stream + current git state. Output: structured JSON for MCP, human-readable Markdown for CLI.
6. **Drift check** — diff `IntentStatus(completed).verification.commit_sha` set against `git log` since the last `Checkpoint`. Surface mismatches.
7. **Bootstrap prompt** — small template that turns digest JSON into a Claude Code resume context block.

## Open Questions

1. **Plan supersession.** When a new `Plan` is posted with `supersedes`, do open intents on the prior plan auto-`abandoned`, or stay open until explicitly resolved? Lean: stay open, surface in digest as "orphaned intents from prior plan."
2. **Session boundary.** What ends a session — Claude Code process exit, idle timeout, or explicit `ccx_session_end()`? Lean: process exit (MCP stdio closure) writes `ended_at`. Idle timeout is too aggressive given long-running tasks.
3. **Multi-agent same project.** Two CC instances writing to one project — allowed? Lean: yes, distinguished by `session_id`. Digest shows per-session activity.
4. **Verbatim human feedback capture.** How does the agent reliably capture this? It only sees the user's text — fine — but it must remember to post it. CLAUDE.md instruction may be sufficient; revisit if it's flaky in practice.
5. **Retention.** Events accumulate forever? Lean: yes, append-only is the point. Add `ccx vacuum` later if needed.
6. **Implementation language.** TypeScript MCP server (per current plan) or Go (better fit with the existing `.NET 10 MCP server framework` work and the Baker Street worldview)? Lean TypeScript for ecosystem maturity around MCP, but Go is a defensible alternative.

---

## CLAUDE.md Hints

### Global `~/.claude/CLAUDE.md` addition

```markdown
## ccx Event Log

This machine has the `ccx-mcp-server` MCP server installed. Use it to maintain
session state across disconnects and context switches.

**On starting work in a repo with `.ccx/project.toml`:**
Call `ccx_digest()` first. Read it before reading source files. Address open
Questions, blocked intents, and drift discrepancies before starting new work.

**On posting events:**
The log exists so a future instance of you (or the user after a disconnect)
can reconstruct state without re-reading scrollback. Post an event when it
materially helps that goal. Do not post an event for every turn or every
interaction — a noisy log is worse than no log.

Useful heuristic: would a fresh Claude Code instance, reading only the digest,
reach the same understanding of the work that you have right now? If something
has changed that the answer depends on, post it. If not, don't.

Concretely:

- Post a `Plan` when there's an actual multi-step plan you and the user agreed
  on. Not for single-step requests, not for exploratory back-and-forth.
- Post `Intent` + `IntentStatus` for the steps of a Plan. Skip for trivial
  intra-step actions.
- Post `Decision` only for choices that future-you would otherwise have to
  re-derive. "Use Authelia not Keycloak" yes; "named the variable `userId`" no.
- Post `Assumption` when you proceed without explicit confirmation AND the
  assumption could plausibly be wrong AND being wrong would matter.
- Post `Discovery` for facts that will affect later work in this repo. Not for
  things any reader of the README would already know.
- Post `Issue` for problems worth remembering. Transient errors you fixed in
  the same turn don't qualify.
- Post `Question` when you are actually stuck and need the human. Stop work
  after posting — do not speculate forward.
- Post `Artifact` for files touched in service of an Intent. Don't post for
  every read, every grep, every transient edit.
- Post `Revert` whenever you undo prior work. This one is rarely
  over-recorded; err toward posting.
- Post `HumanFeedback` when the user steers, corrects, or clarifies in a way
  that would matter on resume. Not for "thanks" or "ok continue."
- Post `Checkpoint` after meaningful commits or successful test runs, and
  before risky operations. Not after every command.
- Post `PlanComplete` when the Plan is done.

**Verification is mandatory for `IntentStatus(completed)`.** Include the commit
SHA if code changed and a test command + exit code if tests were run. If
neither applies, set both to null and put the evidence in `evidence_note`.
**Do not invent verification data.** A false completion claim is worse than
no claim.

**Do not** retroactively post events for earlier turns. Append-only,
timestamped — backdating corrupts the log.
```

### Per-repo `.ccx/project.toml`

```toml
# Generated by `ccx init`. Do not edit `id` by hand.
id = "abc123def456..."  # first-commit SHA of this repo
name = "baker-street"

[hints]
# Optional repo-specific instructions appended to the digest bootstrap.
test_command = "pnpm test"
build_command = "pnpm build"
```

### Per-repo `CLAUDE.md` addition (optional, project-specific)

```markdown
## ccx for this repo

This project uses ccx. Test command is `pnpm test`. When posting
`IntentStatus(completed).verification`, prefer running the affected test file
rather than the full suite for fast intents.

Checkpoint cadence: every meaningful commit, plus before any migration or
destructive change.
```

---

## Phase 2: Analysis System (Sketch)

Phase 2 turns the event log into a feedback loop. Not for this build, but called out so Phase 1 schema doesn't paint into a corner.

### Goals

1. **Self-audit.** Detect when intents complete without verification, when assumptions go un-validated, when questions go unanswered for >N days.
2. **Calibration feedback.** Per-project, per-event-type frequency analysis. Flag chronically over-recorded types (e.g., "this project posts Decision for trivial choices") and chronically under-recorded ones (e.g., "many commits without matching IntentStatus events"). Empirical signal for whether the agent is calibrated to the "would a fresh instance need this?" heuristic.
3. **Pattern mining.** What kinds of work generate the most reverts? Which assumptions tend to be wrong? Which decisions get reversed?
4. **Cross-project learning.** "On this kind of task, we typically also need to..." — derived from prior project event logs.
5. **Resume quality scoring.** After resume, did the agent immediately have to re-ask things? That's a digest quality signal.

### Sketched additions

- `ccx analyze --project <id>` — runs a Claude API pass over the project's event stream and produces an analysis report.
- `ccx vacuum` — calibration analysis pass; outputs a report on event-frequency anomalies. Optionally writes an `Advisory` event back to the project log so the next session sees the calibration feedback in its digest.
- New event type `Retrospective` — output of analysis, queryable like any other event.
- New event type `LessonLearned` — extracted patterns, cross-project. Stored with project_id=null or a special "global" project.
- New event type `Advisory` — calibration nudges from `ccx vacuum`.
- Embedding column on events (`payload_embedding VECTOR`) to support semantic search across projects. Voyage AI is the natural choice given Resolve precedent.

### Phase 1 schema accommodations

- `events.payload` is JSONB — adding fields per type is non-breaking.
- Reserve event type names `Retrospective`, `LessonLearned`, and `Advisory` — don't use them in Phase 1.
- Leave room for `events.payload_embedding` — add the column in Phase 2 with a backfill job.

No Phase 1 work needs to anticipate Phase 2 beyond not breaking these.

---

## Definition of Done (Phase 1)

- [ ] `ccx-mcp-server` installs cleanly on each workstation, registered globally in `~/.claude.json`.
- [ ] `ccx init` works in a fresh repo and an existing repo.
- [ ] All 13 event types post and validate.
- [ ] `ccx_digest()` returns a usable resume view in <500ms on a project with 1000 events.
- [ ] Drift check correctly flags overclaiming (test: post `IntentStatus(completed)` with a commit SHA that doesn't exist on the current branch).
- [ ] Local SQLite fallback works when the database host is unreachable; sync flushes on reconnect.
- [ ] CLI commands (`tail`, `digest`, `blocked`, `drift`, `replay`, `projects`) all functional.
- [ ] Global CLAUDE.md updated on each workstation with the calibrated guidance.
- [ ] At least one real Baker Street session run end-to-end through ccx, with the resume digest consumed by a fresh Claude Code instance.
