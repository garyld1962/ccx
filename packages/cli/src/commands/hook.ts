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
    const rawMsg = err instanceof Error ? err.message : String(err);
    // Keep the log entry to one line — underlying errors (e.g. git failures)
    // often embed newlines in their message.
    const msg = rawMsg.replace(/\s*\n\s*/g, ' ').trim();
    fs.appendFileSync(HOOK_LOG, `${new Date().toISOString()} ${sub}: ${msg}\n`);
  } catch {
    // Even the error log failing must not break the hook.
  }
}

export async function runHook(sub: string | undefined): Promise<void> {
  try {
    if (sub === undefined) throw new Error('no hook event argument supplied');
    await dispatch(sub);
  } catch (err) {
    logHookError(sub ?? '(missing-event)', err);
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
    projectName: project.name,
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
        const payload =
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'SessionStart',
              additionalContext:
                '## ccx digest (auto-injected at session start)\n\n' +
                formatDigest(d, project.name),
            },
          }) + '\n';
        await new Promise<void>((resolve) => process.stdout.write(payload, () => resolve()));
        break;
      }
      case 'task-created': {
        const t = taskFields(input);
        if (t) {
          // task_id is session-scoped ("1", "2", ...), not globally unique —
          // namespace by CC session id before storing.
          const ccTaskId = `${input.session_id}:${t.taskId}`;
          await recordTaskCreated(client.db, ref, { ccTaskId, description: t.subject });
        }
        break;
      }
      case 'task-completed': {
        const t = taskFields(input);
        if (t) {
          const ccTaskId = `${input.session_id}:${t.taskId}`;
          const git = readGitState(project.rootDir);
          await recordTaskCompleted(client.db, ref, { ccTaskId, git });
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
