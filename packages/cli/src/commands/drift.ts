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
