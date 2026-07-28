import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveProject } from '../src/project.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-proj-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.invalid']);
  git(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'one']);
  return dir;
}

describe('resolveProject', () => {
  let tmp: string;

  beforeEach(() => { tmp = makeRepo(); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('reads .ccx/project.toml when present', () => {
    fs.mkdirSync(path.join(tmp, '.ccx'));
    fs.writeFileSync(
      path.join(tmp, '.ccx', 'project.toml'),
      'id = "deadbeef"\nname = "my-proj"\n',
    );
    const p = resolveProject(tmp);
    expect(p).toEqual({ id: 'deadbeef', name: 'my-proj', source: 'toml' });
  });

  it('walks up to find .ccx/project.toml', () => {
    fs.mkdirSync(path.join(tmp, '.ccx'));
    fs.writeFileSync(
      path.join(tmp, '.ccx', 'project.toml'),
      'id = "deadbeef"\nname = "my-proj"\n',
    );
    const sub = path.join(tmp, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });
    const p = resolveProject(sub);
    expect(p?.id).toBe('deadbeef');
  });

  it('falls back to first-commit SHA when no toml', () => {
    const p = resolveProject(tmp);
    expect(p).not.toBeNull();
    expect(p?.id).toMatch(/^[0-9a-f]{40}$/);
    expect(p?.source).toBe('git');
    expect(p?.name).toBe(path.basename(tmp));
  });

  it('returns null in a non-git, no-toml directory', () => {
    const noGit = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-nogit-'));
    try {
      const p = resolveProject(noGit);
      expect(p).toBeNull();
    } finally {
      fs.rmSync(noGit, { recursive: true, force: true });
    }
  });
});
