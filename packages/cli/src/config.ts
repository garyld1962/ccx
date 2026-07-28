import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parse as parseToml } from 'smol-toml';

export function getDatabaseUrl(): string {
  const url = process.env.CCX_DATABASE_URL;
  if (url) return url;
  const cfgPath = path.join(os.homedir(), '.ccx', 'config.toml');
  if (fs.existsSync(cfgPath)) {
    const parsed = parseToml(fs.readFileSync(cfgPath, 'utf-8')) as { database_url?: string };
    if (parsed.database_url) return parsed.database_url;
  }
  throw new Error('CCX_DATABASE_URL is not set and ~/.ccx/config.toml has no database_url');
}
