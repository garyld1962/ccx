import { z } from 'zod';
import { UlidSchema } from '../envelope.js';

export const IntentStatusValueSchema = z.enum([
  'started',
  'completed',
  'blocked',
  'abandoned',
]);

export type IntentStatusValue = z.infer<typeof IntentStatusValueSchema>;

export const VerificationSchema = z.object({
  commit_sha: z.string().nullable(),
  test_command: z.string().nullable(),
  test_exit_code: z.number().int().nullable(),
  evidence_note: z.string().max(200),
});

export type Verification = z.infer<typeof VerificationSchema>;

export const IntentStatusPayloadSchema = z
  .object({
    intent_id: UlidSchema,
    status: IntentStatusValueSchema,
    verification: VerificationSchema.optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .refine(
    (v) => v.status !== 'completed' || v.verification !== undefined,
    { message: 'verification is required when status is "completed"', path: ['verification'] },
  )
  .refine(
    (v) => !(v.status === 'blocked' || v.status === 'abandoned') || v.reason !== undefined,
    { message: 'reason is required when status is "blocked" or "abandoned"', path: ['reason'] },
  );

export type IntentStatusPayload = z.infer<typeof IntentStatusPayloadSchema>;
