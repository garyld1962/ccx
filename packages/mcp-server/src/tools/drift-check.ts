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
