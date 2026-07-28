import { describe, it, expect } from 'vitest';
import { QuestionPayloadSchema } from '../../src/events/question.js';

describe('QuestionPayloadSchema', () => {
  it('accepts a minimal Question (defaults blocks_intent_id=null, options_considered=[])', () => {
    const r = QuestionPayloadSchema.parse({
      question: 'Should we use async/await?',
    });
    expect(r.blocks_intent_id).toBeNull();
    expect(r.options_considered).toEqual([]);
  });

  it('accepts with a ULID blocks_intent_id and a non-empty options list', () => {
    expect(() =>
      QuestionPayloadSchema.parse({
        question: 'Should we use async/await?',
        blocks_intent_id: '01J9X8K7M6N5P4Q3R2S1T0V9W8',
        options_considered: ['async/await', 'promises', 'callbacks'],
      }),
    ).not.toThrow();
  });

  it('rejects empty question', () => {
    expect(() =>
      QuestionPayloadSchema.parse({
        question: '',
      }),
    ).toThrow();
  });

  it('rejects question >500 chars', () => {
    expect(() =>
      QuestionPayloadSchema.parse({
        question: 'x'.repeat(501),
      }),
    ).toThrow();
  });

  it('rejects non-ULID blocks_intent_id', () => {
    expect(() =>
      QuestionPayloadSchema.parse({
        question: 'Should we use async/await?',
        blocks_intent_id: 'not-a-ulid',
      }),
    ).toThrow();
  });
});
