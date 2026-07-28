import { describe, it, expect } from 'vitest';
import { ArtifactPayloadSchema } from '../../src/events/artifact.js';

describe('ArtifactPayloadSchema', () => {
  it('accepts each of created|modified|deleted|moved for action', () => {
    expect(() =>
      ArtifactPayloadSchema.parse({
        path: '/src/index.ts',
        action: 'created',
        summary: 'Added main entry point',
      }),
    ).not.toThrow();

    expect(() =>
      ArtifactPayloadSchema.parse({
        path: '/src/index.ts',
        action: 'modified',
        summary: 'Updated logic',
      }),
    ).not.toThrow();

    expect(() =>
      ArtifactPayloadSchema.parse({
        path: '/src/index.ts',
        action: 'deleted',
        summary: 'Removed old code',
      }),
    ).not.toThrow();

    expect(() =>
      ArtifactPayloadSchema.parse({
        path: '/src/index.ts',
        action: 'moved',
        summary: 'Relocated file',
      }),
    ).not.toThrow();
  });

  it('accepts with parent_intent_id null (default) and with a ULID', () => {
    const rDefault = ArtifactPayloadSchema.parse({
      path: '/src/index.ts',
      action: 'created',
      summary: 'Added main entry point',
    });
    expect(rDefault.parent_intent_id).toBeNull();

    expect(() =>
      ArtifactPayloadSchema.parse({
        parent_intent_id: '01J9X8K7M6N5P4Q3R2S1T0V9W8',
        path: '/src/index.ts',
        action: 'created',
        summary: 'Added main entry point',
      }),
    ).not.toThrow();
  });

  it('rejects unknown action', () => {
    expect(() =>
      ArtifactPayloadSchema.parse({
        path: '/src/index.ts',
        action: 'unknown',
        summary: 'Added main entry point',
      }),
    ).toThrow();
  });

  it('rejects empty path', () => {
    expect(() =>
      ArtifactPayloadSchema.parse({
        path: '',
        action: 'created',
        summary: 'Added main entry point',
      }),
    ).toThrow();
  });

  it('rejects summary >200 chars', () => {
    expect(() =>
      ArtifactPayloadSchema.parse({
        path: '/src/index.ts',
        action: 'created',
        summary: 'x'.repeat(201),
      }),
    ).toThrow();
  });

  it('rejects non-ULID parent_intent_id', () => {
    expect(() =>
      ArtifactPayloadSchema.parse({
        parent_intent_id: 'not-a-ulid',
        path: '/src/index.ts',
        action: 'created',
        summary: 'Added main entry point',
      }),
    ).toThrow();
  });
});
