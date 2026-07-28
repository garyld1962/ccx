import { createClient, queryEvents } from '@ccx/storage';
import { getDatabaseUrl } from '../config.js';
import { requireProjectOrExit } from '../project.js';
import { formatTail } from '../format.js';

export async function runTail(opts: { limit?: number } = {}, cwd: string = process.cwd()): Promise<void> {
  const project = requireProjectOrExit(cwd);
  const client = createClient(getDatabaseUrl());
  try {
    const events = await queryEvents(client.db, { projectId: project.id, limit: opts.limit ?? 20 });
    process.stdout.write(formatTail(events) + '\n');
  } finally {
    await client.close();
  }
}
