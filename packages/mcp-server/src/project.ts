import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { computeFirstCommitSha } from '@ccx/storage';

export interface ResolvedProject {
  id: string;
  name: string;
  source: 'toml' | 'git';
}

function findProjectToml(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, '.ccx', 'project.toml');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function resolveProject(cwd: string): ResolvedProject | null {
  const tomlPath = findProjectToml(cwd);
  if (tomlPath) {
    const parsed = parseToml(fs.readFileSync(tomlPath, 'utf-8')) as { id: string; name: string };
    if (typeof parsed.id !== 'string' || parsed.id === '' || typeof parsed.name !== 'string' || parsed.name === '') {
      throw new Error(`invalid .ccx/project.toml at ${tomlPath}: id and name must be non-empty strings`);
    }
    return { id: parsed.id, name: parsed.name, source: 'toml' };
  }
  try {
    const id = computeFirstCommitSha(cwd);
    return { id, name: path.basename(path.resolve(cwd)), source: 'git' };
  } catch {
    return null;
  }
}
