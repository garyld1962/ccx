import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseToml } from 'smol-toml';

export interface CliProject {
  id: string;
  name: string;
  rootDir: string; // directory containing .ccx/
}

export function loadProject(cwd: string): CliProject | null {
  let dir = path.resolve(cwd);
  while (true) {
    const candidate = path.join(dir, '.ccx', 'project.toml');
    if (fs.existsSync(candidate)) {
      const parsed = parseToml(fs.readFileSync(candidate, 'utf-8')) as {
        id: string;
        name: string;
      };
      if (typeof parsed.id !== 'string' || parsed.id === '' || typeof parsed.name !== 'string' || parsed.name === '') {
        throw new Error(`invalid .ccx/project.toml at ${candidate}: id and name must be non-empty strings`);
      }
      return { id: parsed.id, name: parsed.name, rootDir: dir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireProjectOrExit(cwd: string): CliProject {
  const p = loadProject(cwd);
  if (!p) {
    process.stderr.write('No .ccx/project.toml found. Run `ccx init` first.\n');
    process.exit(1);
  }
  return p;
}
