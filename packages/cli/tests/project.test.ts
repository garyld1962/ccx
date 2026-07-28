import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadProject } from '../src/project.js';

describe('loadProject', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-project-'));
    fs.mkdirSync(path.join(tmp, '.ccx'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('throws on a truncated/corrupt project.toml missing id/name', () => {
    fs.writeFileSync(path.join(tmp, '.ccx', 'project.toml'), 'name = "x"\n');
    expect(() => loadProject(tmp)).toThrow(/invalid \.ccx\/project\.toml/);
  });

  it('loads a valid project.toml', () => {
    fs.writeFileSync(
      path.join(tmp, '.ccx', 'project.toml'),
      'id = "abc123"\nname = "myproj"\n',
    );
    const p = loadProject(tmp);
    expect(p).toEqual({ id: 'abc123', name: 'myproj', rootDir: tmp });
  });
});
