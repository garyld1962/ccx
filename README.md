# ccx

[![CI](https://github.com/garyld1962/ccx/actions/workflows/ci.yml/badge.svg)](https://github.com/garyld1962/ccx/actions/workflows/ci.yml)

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
- `packages/mcp-server` — stdio MCP server (8 tools)
- `packages/cli` — `ccx init|digest|tail|blocked|drift|replay|projects|hook`

## Proof

- **147 tests across 25 files** — `pnpm test`
- **Requires Docker**: the storage suite spins up an ephemeral `postgres:16-alpine` testcontainer and
  applies migrations per run. Coverage is concentrated in `schema` (73) and `storage` (45); the MCP
  tool handlers are the thin spot.

## Status

Phase 1 revised (hooks-based capture). **8 event types are implemented**; `Assumption`, `Discovery`,
`Issue`, `Revert`, and `PlanComplete` are reserved names deferred to Phase 2 — validating a payload
for those throws. Plan 3 adds a SQLite local fallback.

## Quick start

```bash
pnpm install && pnpm build

# 1. Create a Postgres database called `ccx`, then point ccx at it
printf 'database_url = "postgresql://user:pass@host:5432/ccx"\n' > ~/.ccx/config.toml
chmod 600 ~/.ccx/config.toml     # hooks read from here, not the environment

# 2. Apply migrations
psql "$(python3 -c "import tomllib,os;print(tomllib.load(open(os.path.expanduser('~/.ccx/config.toml'),'rb'))['database_url'])")" \
  -f packages/storage/drizzle/0001_*.sql

# 3. In any project repo
node <path-to-ccx>/packages/cli/dist/index.js init   # creates .ccx/project.toml
```

Then register the five hooks (SessionStart, SessionEnd, TaskCreated, TaskCompleted, and PostToolUse
matching `Write|Edit|MultiEdit|NotebookEdit`) in `~/.claude/settings.json`, each running
`node <path-to-ccx>/packages/cli/dist/index.js hook <event>` with a 10s timeout and reading hook JSON
from stdin. For the semantic tools, register the MCP server in `~/.claude.json`.

## License

MIT
