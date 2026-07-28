import { z } from 'zod';
import { UlidSchema } from '../envelope.js';

export const ArtifactActionSchema = z.enum(['created', 'modified', 'deleted', 'moved']);

export const ArtifactPayloadSchema = z.object({
  parent_intent_id: UlidSchema.nullable().default(null),
  path: z.string().min(1),
  action: ArtifactActionSchema,
  summary: z.string().min(1).max(200),
});

export type ArtifactPayload = z.infer<typeof ArtifactPayloadSchema>;
