# Captured Claude Code hook payloads

Captured 2026-07-17 on a Linux workstation (Claude Code headless session) via temporary
logging hooks (`cat >> ~/.ccx/hook-samples.jsonl`). These are the payload
shapes `packages/cli/src/hook-input.ts` maps. If Claude Code changes these,
fix the mapping there only.

## Field map (verified)

| ccx needs | actual JSON path |
|---|---|
| CC session id | `.session_id` |
| working dir | `.cwd` |
| event name | `.hook_event_name` |
| edited file path | `.tool_input.file_path` (Write/Edit/MultiEdit); `.tool_input.notebook_path` assumed for NotebookEdit (not captured — fallback kept) |
| tool name | `.tool_name` |
| task id | `.task_id` (**flat**, not nested under `.task`) |
| task subject | `.task_subject` (fallback `.task_description`) |

Notes:
- Task fields are FLAT (`task_id`/`task_subject`/`task_description`) — the
  nested `.task.{id,subject}` shape guessed in the plan does not exist.
- `task_id` values are small integers as strings (`"1"`) scoped to a session,
  NOT globally unique. ccx must namespace them per CC session when matching
  (see `cc_task_id` note in hook-actions).
- `SessionStart` carries `source` (`"startup"`), `SessionEnd` carries `reason`.
- All events also carry `transcript_path`; `PostToolUse` adds `tool_response`,
  `tool_use_id`, `duration_ms`, `permission_mode`.

## Raw samples (one per event)

### SessionStart
```json
{"session_id":"31877063-ecf3-4c72-9ac5-25e456e56f3b","transcript_path":"~/.claude/projects/-tmp-ccx-hookcapture-252559/31877063-ecf3-4c72-9ac5-25e456e56f3b.jsonl","cwd":"/tmp/ccx-hookcapture-252559","hook_event_name":"SessionStart","source":"startup"}
```

### TaskCreated
```json
{"session_id":"31877063-ecf3-4c72-9ac5-25e456e56f3b","transcript_path":"...","cwd":"/tmp/ccx-hookcapture-252559","prompt_id":"acc28a7f-c500-4440-ab5d-d99ea42bdf4f","hook_event_name":"TaskCreated","task_id":"1","task_subject":"alpha step","task_description":"alpha step"}
```

### TaskCompleted
```json
{"session_id":"31877063-ecf3-4c72-9ac5-25e456e56f3b","transcript_path":"...","cwd":"/tmp/ccx-hookcapture-252559","prompt_id":"acc28a7f-c500-4440-ab5d-d99ea42bdf4f","hook_event_name":"TaskCompleted","task_id":"1","task_subject":"alpha step","task_description":"alpha step"}
```

### PostToolUse (Write)
```json
{"session_id":"31877063-ecf3-4c72-9ac5-25e456e56f3b","transcript_path":"...","cwd":"/tmp/ccx-hookcapture-252559","prompt_id":"acc28a7f-c500-4440-ab5d-d99ea42bdf4f","permission_mode":"default","effort":{"level":"high"},"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"/tmp/ccx-hookcapture-252559/scratch.txt","content":"hello\n"},"tool_response":{"type":"create","filePath":"/tmp/ccx-hookcapture-252559/scratch.txt","content":"hello\n","structuredPatch":[],"originalFile":null,"userModified":false},"tool_use_id":"toolu_011rQ5b9TzuHqWpDNRUCxgYX","duration_ms":7}
```

### SessionEnd
```json
{"session_id":"31877063-ecf3-4c72-9ac5-25e456e56f3b","transcript_path":"...","cwd":"/tmp/ccx-hookcapture-252559","prompt_id":"acc28a7f-c500-4440-ab5d-d99ea42bdf4f","hook_event_name":"SessionEnd","reason":"other"}
```
