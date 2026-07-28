import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runInit } from '../src/commands/init.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-init-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.invalid']);
  git(dir, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'one']);
  return dir;
}

describe('ccx init', () => {
  let tmp: string;

  beforeEach(() => { tmp = makeRepo(); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('writes .ccx/project.toml with first-commit SHA', async () => {
    await runInit(tmp);
    const tomlPath = path.join(tmp, '.ccx', 'project.toml');
    expect(fs.existsSync(tomlPath)).toBe(true);
    const content = fs.readFileSync(tomlPath, 'utf-8');
    expect(content).toMatch(/id = "[0-9a-f]{40}"/);
    expect(content).toMatch(`name = "${path.basename(tmp)}"`);
  });

  it('does not overwrite an existing project.toml', async () => {
    fs.mkdirSync(path.join(tmp, '.ccx'));
    fs.writeFileSync(
      path.join(tmp, '.ccx', 'project.toml'),
      'id = "preexisting"\nname = "x"\n',
    );
    await runInit(tmp);
    const content = fs.readFileSync(path.join(tmp, '.ccx', 'project.toml'), 'utf-8');
    expect(content).toContain('preexisting');
  });

  it('errors clearly outside a git repo and without existing toml', async () => {
    const noGit = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-init-nogit-'));
    try {
      await expect(runInit(noGit)).rejects.toThrow(/git/i);
    } finally {
      fs.rmSync(noGit, { recursive: true, force: true });
    }
  });
});
