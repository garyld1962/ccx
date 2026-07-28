import { describe, it, expect } from 'vitest';
import { IntentPayloadSchema } from '../../src/events/intent.js';

describe('IntentPayloadSchema', () => {
  const base = {
    parent_plan_id: '01J9X8K7M6N5P4Q3R2S1T0V9W8',
    description: 'Implement parser',
    ordinal: 0,
  };

  it('accepts a valid intent', () => {
    expect(() => IntentPayloadSchema.parse(base)).not.toThrow();
  });

  it('rejects non-ULID parent_plan_id', () => {
    expect(() => IntentPayloadSchema.parse({ ...base, parent_plan_id: 'x' })).toThrow();
  });

  it('rejects description >500 chars', () => {
    expect(() => IntentPayloadSchema.parse({ ...base, description: 'x'.repeat(501) })).toThrow();
  });

  it('rejects negative ordinal', () => {
    expect(() => IntentPayloadSchema.parse({ ...base, ordinal: -1 })).toThrow();
  });

  it('rejects non-integer ordinal', () => {
    expect(() => IntentPayloadSchema.parse({ ...base, ordinal: 1.5 })).toThrow();
  });

  it('accepts null parent_plan_id', () => {
    const r = IntentPayloadSchema.safeParse({ parent_plan_id: null, description: 'x', ordinal: 0 });
    expect(r.success).toBe(true);
  });

  it('defaults parent_plan_id to null when omitted', () => {
    const r = IntentPayloadSchema.parse({ description: 'x', ordinal: 0 });
    expect(r.parent_plan_id).toBeNull();
  });

  it('accepts an optional cc_task_id string', () => {
    const r = IntentPayloadSchema.parse({ parent_plan_id: null, description: 'x', ordinal: 0, cc_task_id: 'task-1' });
    expect(r.cc_task_id).toBe('task-1');
  });

  it('rejects empty cc_task_id', () => {
    const r = IntentPayloadSchema.safeParse({ parent_plan_id: null, description: 'x', ordinal: 0, cc_task_id: '' });
    expect(r.success).toBe(false);
  });
});
