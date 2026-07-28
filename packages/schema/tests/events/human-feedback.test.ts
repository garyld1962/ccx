import { describe, it, expect } from 'vitest';
import { HumanFeedbackPayloadSchema } from '../../src/events/human-feedback.js';

describe('HumanFeedbackPayloadSchema', () => {
  it('accepts a valid HumanFeedback', () => {
    expect(() =>
      HumanFeedbackPayloadSchema.parse({
        verbatim: 'This approach is too complex.',
        interpreted_as: 'Simplify the architecture',
      }),
    ).not.toThrow();
  });

  it('rejects empty verbatim', () => {
    expect(() =>
      HumanFeedbackPayloadSchema.parse({
        verbatim: '',
        interpreted_as: 'Simplify the architecture',
      }),
    ).toThrow();
  });

  it('rejects verbatim >2000 chars', () => {
    expect(() =>
      HumanFeedbackPayloadSchema.parse({
        verbatim: 'x'.repeat(2001),
        interpreted_as: 'Simplify the architecture',
      }),
    ).toThrow();
  });

  it('rejects empty interpreted_as', () => {
    expect(() =>
      HumanFeedbackPayloadSchema.parse({
        verbatim: 'This approach is too complex.',
        interpreted_as: '',
      }),
    ).toThrow();
  });

  it('rejects interpreted_as >500 chars', () => {
    expect(() =>
      HumanFeedbackPayloadSchema.parse({
        verbatim: 'This approach is too complex.',
        interpreted_as: 'x'.repeat(501),
      }),
    ).toThrow();
  });
});
