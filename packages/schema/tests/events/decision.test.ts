import { describe, it, expect } from 'vitest';
import { DecisionPayloadSchema } from '../../src/events/decision.js';

describe('DecisionPayloadSchema', () => {
  it('accepts a minimal Decision with no parent_plan_id and no alternatives', () => {
    const r = DecisionPayloadSchema.parse({
      decision: 'Use TypeScript',
      rationale: 'Type safety improves code quality',
    });
    expect(r.parent_plan_id).toBeNull();
    expect(r.alternatives_considered).toEqual([]);
  });

  it('accepts a Decision with parent_plan_id (ULID) and alternatives_considered', () => {
    expect(() =>
      DecisionPayloadSchema.parse({
        parent_plan_id: '01J9X8K7M6N5P4Q3R2S1T0V9W8',
        decision: 'Use TypeScript',
        rationale: 'Type safety improves code quality',
        alternatives_considered: ['JavaScript', 'Python'],
      }),
    ).not.toThrow();
  });

  it('rejects empty decision', () => {
    expect(() =>
      DecisionPayloadSchema.parse({
        decision: '',
        rationale: 'Type safety improves code quality',
      }),
    ).toThrow();
  });

  it('rejects decision >300 chars', () => {
    expect(() =>
      DecisionPayloadSchema.parse({
        decision: 'x'.repeat(301),
        rationale: 'Type safety improves code quality',
      }),
    ).toThrow();
  });

  it('rejects empty rationale', () => {
    expect(() =>
      DecisionPayloadSchema.parse({
        decision: 'Use TypeScript',
        rationale: '',
      }),
    ).toThrow();
  });

  it('rejects rationale >1000 chars', () => {
    expect(() =>
      DecisionPayloadSchema.parse({
        decision: 'Use TypeScript',
        rationale: 'x'.repeat(1001),
      }),
    ).toThrow();
  });

  it('rejects non-ULID parent_plan_id', () => {
    expect(() =>
      DecisionPayloadSchema.parse({
        parent_plan_id: 'not-a-ulid',
        decision: 'Use TypeScript',
        rationale: 'Type safety improves code quality',
      }),
    ).toThrow();
  });

  it('defaults alternatives_considered to []', () => {
    const r = DecisionPayloadSchema.parse({
      decision: 'Use TypeScript',
      rationale: 'Type safety improves code quality',
    });
    expect(r.alternatives_considered).toEqual([]);
  });

  it('defaults parent_plan_id to null', () => {
    const r = DecisionPayloadSchema.parse({
      decision: 'Use TypeScript',
      rationale: 'Type safety improves code quality',
    });
    expect(r.parent_plan_id).toBeNull();
  });
});
