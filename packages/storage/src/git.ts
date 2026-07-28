import { execFileSync } from 'node:child_process';

export interface GitState {
  branch: string;
  commitSha: string;
  workingTreeClean: boolean;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

export function readGitState(cwd: string): GitState {
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const commitSha = git(cwd, ['rev-parse', 'HEAD']).trim();
  const status = git(cwd, ['status', '--porcelain']);
  return { branch, commitSha, workingTreeClean: status.trim() === '' };
}

export function computeFirstCommitSha(cwd: string): string {
  const out = git(cwd, ['rev-list', '--max-parents=0', 'HEAD']).trim();
  // Multiple root commits possible; take lexicographically first for determinism.
  return out.split('\n').sort()[0]!;
}

export function commitsSince(cwd: string, baselineSha: string): string[] {
  // Throws if baseline is unknown — useful for surfacing stale checkpoints.
  execFileSync('git', ['cat-file', '-e', `${baselineSha}^{commit}`], { cwd, stdio: 'pipe' });
  const out = git(cwd, ['log', '--format=%H', `${baselineSha}..HEAD`]).trim();
  if (out === '') return [];
  return out.split('\n');
}

export function commitExists(cwd: string, sha: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
