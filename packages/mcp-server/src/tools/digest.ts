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
