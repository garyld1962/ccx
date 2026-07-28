import { describe, it, expect } from 'vitest';
import { PlanPayloadSchema } from '../../src/events/plan.js';

describe('PlanPayloadSchema', () => {
  it('accepts a minimal valid plan and defaults supersedes to null', () => {
    const parsed = PlanPayloadSchema.parse({
      title: 'Build feature X',
      summary: 'Three-step plan covering A, B, C.',
    });
    expect(parsed.supersedes).toBe(null);
  });

  it('accepts a plan with supersedes set', () => {
    expect(() =>
      PlanPayloadSchema.parse({
        title: 't',
        summary: 's',
        supersedes: '01J9X8K7M6N5P4Q3R2S1T0V9W8',
      }),
    ).not.toThrow();
  });

  it('rejects empty title', () => {
    expect(() => PlanPayloadSchema.parse({ title: '', summary: 's' })).toThrow();
  });

  it('rejects title >100 chars', () => {
    expect(() =>
      PlanPayloadSchema.parse({ title: 'x'.repeat(101), summary: 's' }),
    ).toThrow();
  });

  it('rejects summary >2000 chars', () => {
    expect(() =>
      PlanPayloadSchema.parse({ title: 't', summary: 'x'.repeat(2001) }),
    ).toThrow();
  });

  it('rejects non-ULID supersedes', () => {
    expect(() =>
      PlanPayloadSchema.parse({ title: 't', summary: 's', supersedes: 'oops' }),
    ).toThrow();
  });
});
