import { z } from 'zod';
import { UlidSchema } from '../envelope.js';

export const QuestionPayloadSchema = z.object({
  question: z.string().min(1).max(500),
  blocks_intent_id: UlidSchema.nullable().default(null),
  options_considered: z.array(z.string().min(1)).default([]),
});

export type QuestionPayload = z.infer<typeof QuestionPayloadSchema>;
