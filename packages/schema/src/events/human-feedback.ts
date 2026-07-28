import { z } from 'zod';

export const HumanFeedbackPayloadSchema = z.object({
  verbatim: z.string().min(1).max(2000),
  interpreted_as: z.string().min(1).max(500),
});

export type HumanFeedbackPayload = z.infer<typeof HumanFeedbackPayloadSchema>;
