import { z } from 'zod';
import { UlidSchema } from '../envelope.js';

export const IntentPayloadSchema = z.object({
  parent_plan_id: UlidSchema.nullable().default(null),
  description: z.string().min(1).max(500),
  ordinal: z.number().int().min(0),
  cc_task_id: z.string().min(1).optional(),
});

export type IntentPayload = z.infer<typeof IntentPayloadSchema>;
