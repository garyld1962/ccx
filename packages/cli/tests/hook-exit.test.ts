import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fail-soft invariant: `ccx hook` must exit 0 on EVERY code path, including
// commander-level misuse (missing/extra args) and bad stdin. execFileSync
// throws on non-zero exit, so each call not throwing IS the assertion.

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(pkgDir, 'dist', 'index.js');

function runHookCli(args: string[], input: string): string {
  return execFileSync('node', [cliPath, 'hook', ...args], {
    input,
    encoding: 'utf-8',
    timeout: 15_000,
  });
}

const VALID_JSON = JSON.stringify({
  session_id: 's1',
  cwd: os.tmpdir(),
  hook_event_name: 'SessionEnd',
});

describe('ccx hook always exits 0', () => {
  beforeAll(() => {
    if (!fs.existsSync(cliPath)) {
      execFileSync('pnpm', ['--filter', '@ccx/cli', 'build'], {
        cwd: pkgDir,
        stdio: 'pipe',
        timeout: 120_000,
      });
    }
  }, 130_000);

  it('exits 0 with no event argument and empty stdin', () => {
    expect(runHookCli([], '')).toBe('');
  });

  it('exits 0 with an excess argument in a non-ccx dir', () => {
    expect(runHookCli(['session-end', 'extra-arg'], VALID_JSON)).toBe('');
  });

  it('exits 0 on malformed (non-JSON) stdin', () => {
    expect(runHookCli(['session-end'], 'not json {')).toBe('');
  });

  it('exits 0 on an unknown event name', () => {
    expect(runHookCli(['unknown-event'], VALID_JSON)).toBe('');
  });

  it('exits 0 on an unknown option flag', () => {
    expect(runHookCli(['--bogus-flag'], '')).toBe('');
  });
});
