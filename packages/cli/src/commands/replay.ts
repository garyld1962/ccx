import { createClient, queryEvents } from '@ccx/storage';
import { getDatabaseUrl } from '../config.js';
import { requireProjectOrExit } from '../project.js';
import { formatTail } from '../format.js';

export async function runReplay(sessionId: string, cwd: string = process.cwd()): Promise<void> {
  const project = requireProjectOrExit(cwd);
  const client = createClient(getDatabaseUrl());
  try {
    // queryEvents orders newest-first; replay wants oldest-first.
    const events = (await queryEvents(client.db, {
      projectId: project.id, sessionId, limit: 10_000,
    })).slice().reverse();
    process.stdout.write(formatTail(events) + '\n');
  } finally {
    await client.close();
  }
}
