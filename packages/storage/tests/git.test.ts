import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeGitRepo, rmGitRepo } from './helpers/git-fixture.js';
import { readGitState, computeFirstCommitSha, commitsSince } from '../src/git.js';

describe('readGitState', () => {
  let tmp: string;

  beforeEach(() => { tmp = makeGitRepo(); });
  afterEach(() => { rmGitRepo(tmp); });

  it('returns branch, commit sha, and clean tree', () => {
    const state = readGitState(tmp);
    expect(state.branch).toBe('main');
    expect(state.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(state.workingTreeClean).toBe(true);
  });

  it('detects dirty tree', () => {
    fs.writeFileSync(path.join(tmp, 'b.txt'), 'b');
    const state = readGitState(tmp);
    expect(state.workingTreeClean).toBe(false);
  });
});

describe('computeFirstCommitSha', () => {
  let tmp: string;

  beforeEach(() => { tmp = makeGitRepo(); });
  afterEach(() => { rmGitRepo(tmp); });

  it('returns the root commit SHA', () => {
    const expected = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim();
    expect(computeFirstCommitSha(tmp)).toBe(expected);
  });
});

describe('commitsSince', () => {
  let tmp: string;
  beforeEach(() => { tmp = makeGitRepo(); });
  afterEach(() => { rmGitRepo(tmp); });

  it('returns [] when HEAD == baseline', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim();
    expect(commitsSince(tmp, head)).toEqual([]);
  });

  it('returns commits made after baseline, newest first', () => {
    const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(tmp, 'b.txt'), 'b');
    execFileSync('git', ['add', '.'], { cwd: tmp });
    execFileSync('git', ['commit', '-q', '-m', 'two'], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'c.txt'), 'c');
    execFileSync('git', ['add', '.'], { cwd: tmp });
    execFileSync('git', ['commit', '-q', '-m', 'three'], { cwd: tmp });

    const out = commitsSince(tmp, baseline);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^[0-9a-f]{40}$/);
  });

  it('throws when baseline is not a known commit', () => {
    expect(() => commitsSince(tmp, 'a'.repeat(40))).toThrow();
  });
});
