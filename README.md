# ccx

[![CI](https://github.com/garyld1962/ccx/actions/workflows/ci.yml/badge.svg)](https://github.com/garyld1962/ccx/actions/workflows/ci.yml)

## What it does for you

When a Claude Code session ends, everything the agent knew about the work goes with it. The next
session starts from a summary the agent writes about itself, and those summaries drift: tasks get
marked done that were never committed, decisions get re-argued, and open questions get lost.

ccx fixes that by recording what actually happened, as it happens, into a database the agent cannot
edit after the fact. The next session opens with a short digest built from that record: the current
plan, which intents are still open, which questions are waiting on you, recent decisions, and
whether any "done" claim disagrees with git.

In practice you get three things:

- **Resume that you can trust.** The digest comes from logged events, not from the agent's memory.
- **No repeated work.** Decisions and their reasons are on file, so a new session does not re-derive
  them.
- **A check on completion claims.** `ccx drift` compares what the agent said it finished against
  what is actually committed.

## How you use it

Set it up once per machine, then once per repo (see [Quick start](#quick-start)). After that there
is nothing to do in a normal session. Claude Code hooks record session start and end, task creation
and completion, and file edits. The agent posts plans, decisions, questions, and your corrections
through the MCP tools. The digest is injected at the start of every session automatically.

The commands you will reach for by hand:

```bash
ccx digest      # the resume view for the current repo
ccx blocked     # open questions and blocked intents waiting on you
ccx drift       # do the agent's "done" claims match git?  exits 2 if not
ccx tail        # last 20 events, newest first
ccx replay <session-id>   # the full event stream for one session
```

## Why it is built this way

A typed, append-only event log and resume system for Claude Code. Instead of asking an agent to
maintain a free-form `Session.md` — which drifts, because prose always does — ccx records
schema-validated events to Postgres, so resuming a session means querying ground truth rather than
trusting a freshly generated self-summary. Its `drift` command reconciles the agent's completion
claims against actual git state, which is the direct answer to "I already did that."

The design principle, from [`docs/design.md`](docs/design.md): **prose drifts, schemas don't.**
Validation happens server-side and bad payloads are rejected.

## How events get captured

- **Mechanical** — session start/end, task created/completed, and file writes are posted by Claude
  Code hooks invoking `ccx hook <event>` with the hook JSON on stdin. No agent cooperation required.
- **Semantic** — Plan, Decision, Question, and HumanFeedback are posted by the agent through the
  stdio MCP server.

Completion events carry evidence or they don't validate: a commit SHA if the intent produced code, a
test command and exit code if tests ran.

## Layout

- `packages/schema` — Zod envelope + payload schemas
- `packages/storage` — Drizzle client, event append/query, digest, drift check
- `packages/mcp-server` — stdio MCP server (9 tools)
- `packages/cli` — `ccx init|digest|tail|blocked|drift|replay|projects|hook`

## Proof

- **152 tests across 25 files** — `pnpm test`
- **Requires Docker**: the storage suite spins up an ephemeral `postgres:16-alpine` testcontainer and
  applies migrations per run. Coverage is concentrated in `schema` (73) and `storage` (45); the MCP
  tool handlers are the thin spot.

## Status

Phase 1 revised (hooks-based capture). **8 event types are implemented**: `Plan`, `Intent`,
`IntentStatus`, `Decision`, `Question`, `Artifact`, `HumanFeedback`, and `Checkpoint`. `Assumption`,
`Discovery`, `Issue`, `Revert`, and `PlanComplete` are reserved names deferred to Phase 2 — validating a payload
for those throws. Plan 3 adds a SQLite local fallback.

## Quick start

```bash
pnpm install && pnpm build

# 1. Create a Postgres database called `ccx`, then point ccx at it
printf 'database_url = "postgresql://user:pass@host:5432/ccx"\n' > ~/.ccx/config.toml
chmod 600 ~/.ccx/config.toml     # hooks read from here, not the environment

# 2. Apply migrations, in order (0000 creates the tables, 0001 alters them)
DSN="$(python3 -c "import tomllib,os;print(tomllib.load(open(os.path.expanduser('~/.ccx/config.toml'),'rb'))['database_url'])")"
for f in packages/storage/drizzle/*.sql; do psql "$DSN" -f "$f"; done

# 3. Put `ccx` and `ccx-configure` on PATH, and register the hooks + MCP server
./scripts/ccx-configure --install-path --install-global

# 4. In any project repo, from then on
ccx-configure
```

`ccx-configure` verifies the machine-wide plumbing — node >= 22, the built `dist/` entrypoints, a
reachable `database_url`, the five hooks (SessionStart, SessionEnd, TaskCreated, TaskCompleted, and
PostToolUse matching `Write|Edit|MultiEdit|NotebookEdit`) in `~/.claude/settings.json`, and the
`ccx` MCP server in `~/.claude.json` — then runs `ccx init` to write `.ccx/project.toml`. By default
it only *reports* missing global wiring; `--install-global` adds what is absent, backing up each
file to `~/.ccx/backups/` first. `--check` verifies and writes nothing. Every path is idempotent.

## License

MIT
