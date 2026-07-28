import { describe, it, expect } from 'vitest';
import {
  IntentStatusPayloadSchema,
  VerificationSchema,
  IntentStatusValueSchema,
} from '../../src/events/intent-status.js';

const intentId = '01J9X8K7M6N5P4Q3R2S1T0V9W8';
const verification = {
  commit_sha: 'abc123',
  test_command: 'pnpm test',
  test_exit_code: 0,
  evidence_note: 'all tests pass',
};

describe('IntentStatusValueSchema', () => {
  it('accepts the four legal values', () => {
    for (const v of ['started', 'completed', 'blocked', 'abandoned']) {
      expect(() => IntentStatusValueSchema.parse(v)).not.toThrow();
    }
  });

  it('rejects other values', () => {
    expect(() => IntentStatusValueSchema.parse('done')).toThrow();
  });
});

describe('VerificationSchema', () => {
  it('accepts all-null verification with evidence_note', () => {
    expect(() =>
      VerificationSchema.parse({
        commit_sha: null,
        test_command: null,
        test_exit_code: null,
        evidence_note: 'manual smoke test',
      }),
    ).not.toThrow();
  });

  it('rejects evidence_note >200 chars', () => {
    expect(() =>
      VerificationSchema.parse({
        commit_sha: null,
        test_command: null,
        test_exit_code: null,
        evidence_note: 'x'.repeat(201),
      }),
    ).toThrow();
  });
});

describe('IntentStatusPayloadSchema', () => {
  it('accepts started with no verification or reason', () => {
    expect(() =>
      IntentStatusPayloadSchema.parse({ intent_id: intentId, status: 'started' }),
    ).not.toThrow();
  });

  it('accepts completed with verification', () => {
    expect(() =>
      IntentStatusPayloadSchema.parse({
        intent_id: intentId,
        status: 'completed',
        verification,
      }),
    ).not.toThrow();
  });

  it('rejects completed without verification', () => {
    expect(() =>
      IntentStatusPayloadSchema.parse({ intent_id: intentId, status: 'completed' }),
    ).toThrow(/verification is required/);
  });

  it('accepts blocked with reason', () => {
    expect(() =>
      IntentStatusPayloadSchema.parse({
        intent_id: intentId,
        status: 'blocked',
        reason: 'waiting on credentials',
      }),
    ).not.toThrow();
  });

  it('rejects blocked without reason', () => {
    expect(() =>
      IntentStatusPayloadSchema.parse({ intent_id: intentId, status: 'blocked' }),
    ).toThrow(/reason is required/);
  });

  it('rejects abandoned without reason', () => {
    expect(() =>
      IntentStatusPayloadSchema.parse({ intent_id: intentId, status: 'abandoned' }),
    ).toThrow(/reason is required/);
  });

  it('rejects reason >500 chars', () => {
    expect(() =>
      IntentStatusPayloadSchema.parse({
        intent_id: intentId,
        status: 'blocked',
        reason: 'x'.repeat(501),
      }),
    ).toThrow();
  });
});
