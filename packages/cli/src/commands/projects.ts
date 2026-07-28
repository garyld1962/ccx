import { createClient, listProjects } from '@ccx/storage';
import { getDatabaseUrl } from '../config.js';
import { formatProjects } from '../format.js';

export async function runProjects(): Promise<void> {
  const client = createClient(getDatabaseUrl());
  try {
    const rows = await listProjects(client.db);
    process.stdout.write(formatProjects(rows) + '\n');
  } finally {
    await client.close();
  }
}
