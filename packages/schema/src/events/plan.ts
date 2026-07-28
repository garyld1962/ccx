import { z } from 'zod';
import { UlidSchema } from '../envelope.js';

export const PlanPayloadSchema = z.object({
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(2000),
  supersedes: UlidSchema.nullable().default(null),
});

export type PlanPayload = z.infer<typeof PlanPayloadSchema>;
