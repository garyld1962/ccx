import { createClient, computeDigest, readGitState } from '@ccx/storage';
import { getDatabaseUrl } from '../config.js';
import { requireProjectOrExit } from '../project.js';
import { formatDigest } from '../format.js';

export async function runDigest(cwd: string = process.cwd()): Promise<void> {
  const project = requireProjectOrExit(cwd);
  const client = createClient(getDatabaseUrl());
  try {
    const git = readGitState(project.rootDir);
    const d = await computeDigest(client.db, { projectId: project.id, git, cwd: project.rootDir });
    process.stdout.write(formatDigest(d, project.name) + '\n');
  } finally {
    await client.close();
  }
}
