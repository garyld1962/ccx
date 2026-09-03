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
- `packages/mcp-server` — stdio MCP server (9 tools)
- `packages/cli` — `ccx init|digest|tail|blocked|drift|replay|projects|hook`

## Proof

- **152 tests across 25 files** — `pnpm test`
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
