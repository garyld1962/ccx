import { describe, it, expect } from 'vitest';
import { EventSchema, EventTypeSchema, UlidSchema } from '../src/envelope.js';
import { validatePayload } from '../src/payloads.js';

describe('UlidSchema', () => {
  it('accepts a valid ULID', () => {
    expect(() => UlidSchema.parse('01J9X8K7M6N5P4Q3R2S1T0V9W8')).not.toThrow();
  });

  it('rejects a UUID', () => {
    expect(() => UlidSchema.parse('550e8400-e29b-41d4-a716-446655440000')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => UlidSchema.parse('')).toThrow();
  });
});

describe('EventTypeSchema', () => {
  it('accepts all 13 known event types', () => {
    const types = [
      'Plan', 'Intent', 'IntentStatus', 'Decision', 'Assumption',
      'Discovery', 'Issue', 'Question', 'Artifact', 'Revert',
      'HumanFeedback', 'Checkpoint', 'PlanComplete',
    ];
    for (const t of types) {
      expect(() => EventTypeSchema.parse(t)).not.toThrow();
    }
  });

  it('rejects Phase 2 reserved names', () => {
    for (const t of ['Retrospective', 'LessonLearned', 'Advisory']) {
      expect(() => EventTypeSchema.parse(t)).toThrow();
    }
  });
});

describe('EventSchema', () => {
  const valid = {
    id: '01J9X8K7M6N5P4Q3R2S1T0V9W8',
    project_id: 'abc123def456',
    session_id: '01J9X8K7M6N5P4Q3R2S1T0V9W9',
    type: 'Plan' as const,
    created_at: '2026-04-25T12:00:00.000Z',
    payload: { title: 'x', summary: 'y' },
  };

  it('accepts a valid event', () => {
    expect(() => EventSchema.parse(valid)).not.toThrow();
  });

  it('rejects bad ULID in id', () => {
    expect(() => EventSchema.parse({ ...valid, id: 'not-a-ulid' })).toThrow();
  });

  it('rejects unknown event type', () => {
    expect(() => EventSchema.parse({ ...valid, type: 'NotARealType' })).toThrow();
  });

  it('rejects non-ISO created_at', () => {
    expect(() => EventSchema.parse({ ...valid, created_at: '2026-04-25' })).toThrow();
  });
});

describe('validatePayload', () => {
  it.each(['Decision', 'Question', 'HumanFeedback', 'Artifact', 'Checkpoint'] as const)(
    'validatePayload has a validator for %s',
    (type) => {
      expect(() => validatePayload(type, {})).toThrow(/(Required|invalid|expected)/i);
      // Throwing a Zod error (not "No payload validator registered") proves registration.
    },
  );

  it('still rejects Phase-2-deferred types', () => {
    expect(() => validatePayload('Assumption', {})).toThrow(/No payload validator registered/);
  });
});
