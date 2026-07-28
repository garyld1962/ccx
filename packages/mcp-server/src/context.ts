import * as os from 'node:os';
import {
  createClient,
  ensureProject,
  createSession,
  endSession,
  type CcxClient,
  type SessionRow,
} from '@ccx/storage';
import { resolveProject, type ResolvedProject } from './project.js';

export interface ServerContext {
  client: CcxClient;
  project: ResolvedProject;
  session: SessionRow;
  cwd: string;
}

let cached: ServerContext | null = null;
let initPromise: Promise<ServerContext> | null = null;

export async function getContext(cwd: string = process.cwd()): Promise<ServerContext> {
  if (cached) return cached;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const url = process.env.CCX_DATABASE_URL;
    if (!url) throw new Error('CCX_DATABASE_URL is not set');
    const project = resolveProject(cwd);
    if (!project) {
      throw new Error(
        `No .ccx/project.toml and no git history in ${cwd}. Run \`ccx init\` first.`,
      );
    }
    const client = createClient(url, { connectTimeoutSeconds: 3 });
    try {
      await ensureProject(client.db, { id: project.id, name: project.name });
      const session = await createSession(client.db, {
        projectId: project.id,
        host: os.hostname(),
      });
      cached = { client, project, session, cwd };
      return cached;
    } catch (err) {
      await client.close().catch(() => {
        // Best-effort cleanup; the original error is what matters.
      });
      throw err;
    }
  })();

  initPromise.catch(() => {
    // Allow the next tool call to retry instead of returning the same rejection forever.
    initPromise = null;
  });

  return initPromise;
}

export async function shutdownContext(): Promise<void> {
  if (cached) {
    await endSession(cached.client.db, cached.session.id);
    await cached.client.close();
    cached = null;
    initPromise = null;
  }
}
