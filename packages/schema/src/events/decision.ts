import { z } from 'zod';
import { UlidSchema } from '../envelope.js';

export const DecisionPayloadSchema = z.object({
  parent_plan_id: UlidSchema.nullable().default(null),
  decision: z.string().min(1).max(300),
  rationale: z.string().min(1).max(1000),
  alternatives_considered: z.array(z.string().min(1)).default([]),
});

export type DecisionPayload = z.infer<typeof DecisionPayloadSchema>;
