import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getDatabaseUrl } from '../src/config.js';

describe('getDatabaseUrl', () => {
  let tmpHome: string;
  const saved = { env: process.env.CCX_DATABASE_URL, home: process.env.HOME };

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccx-home-'));
    process.env.HOME = tmpHome;
    delete process.env.CCX_DATABASE_URL;
  });
  afterEach(() => {
    process.env.HOME = saved.home;
    if (saved.env === undefined) delete process.env.CCX_DATABASE_URL;
    else process.env.CCX_DATABASE_URL = saved.env;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('prefers the env var', () => {
    process.env.CCX_DATABASE_URL = 'postgresql://env';
    expect(getDatabaseUrl()).toBe('postgresql://env');
  });

  it('falls back to ~/.ccx/config.toml', () => {
    fs.mkdirSync(path.join(tmpHome, '.ccx'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.ccx', 'config.toml'), 'database_url = "postgresql://file"\n');
    expect(getDatabaseUrl()).toBe('postgresql://file');
  });

  it('throws when neither exists', () => {
    expect(() => getDatabaseUrl()).toThrow(/CCX_DATABASE_URL/);
  });
});
