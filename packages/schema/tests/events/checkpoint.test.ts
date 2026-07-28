import { describe, it, expect } from 'vitest';
import { CheckpointPayloadSchema } from '../../src/events/checkpoint.js';

describe('CheckpointPayloadSchema', () => {
  it('accepts a fully-populated Checkpoint', () => {
    expect(() =>
      CheckpointPayloadSchema.parse({
        git_branch: 'main',
        git_commit_sha: 'abc123def456',
        working_tree_clean: true,
        last_test_command: 'npm test',
        last_test_exit_code: 0,
        note: 'All tests passed',
      }),
    ).not.toThrow();
  });

  it('accepts a Checkpoint with last_test_command=null and last_test_exit_code=null', () => {
    expect(() =>
      CheckpointPayloadSchema.parse({
        git_branch: 'main',
        git_commit_sha: 'abc123def456',
        working_tree_clean: true,
        last_test_command: null,
        last_test_exit_code: null,
        note: 'Initial checkpoint',
      }),
    ).not.toThrow();
  });

  it('rejects empty git_branch', () => {
    expect(() =>
      CheckpointPayloadSchema.parse({
        git_branch: '',
        git_commit_sha: 'abc123def456',
        working_tree_clean: true,
        last_test_command: null,
        last_test_exit_code: null,
        note: 'Initial checkpoint',
      }),
    ).toThrow();
  });

  it('rejects empty git_commit_sha', () => {
    expect(() =>
      CheckpointPayloadSchema.parse({
        git_branch: 'main',
        git_commit_sha: '',
        working_tree_clean: true,
        last_test_command: null,
        last_test_exit_code: null,
        note: 'Initial checkpoint',
      }),
    ).toThrow();
  });

  it('rejects note >300 chars', () => {
    expect(() =>
      CheckpointPayloadSchema.parse({
        git_branch: 'main',
        git_commit_sha: 'abc123def456',
        working_tree_clean: true,
        last_test_command: null,
        last_test_exit_code: null,
        note: 'x'.repeat(301),
      }),
    ).toThrow();
  });

  it('rejects non-integer last_test_exit_code', () => {
    expect(() =>
      CheckpointPayloadSchema.parse({
        git_branch: 'main',
        git_commit_sha: 'abc123def456',
        working_tree_clean: true,
        last_test_command: 'npm test',
        last_test_exit_code: 1.5,
        note: 'Tests failed',
      }),
    ).toThrow();
  });

  it('rejects working_tree_clean not a boolean', () => {
    expect(() =>
      CheckpointPayloadSchema.parse({
        git_branch: 'main',
        git_commit_sha: 'abc123def456',
        working_tree_clean: 'true',
        last_test_command: null,
        last_test_exit_code: null,
        note: 'Initial checkpoint',
      }),
    ).toThrow();
  });
});
