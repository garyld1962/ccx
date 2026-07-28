import { z } from 'zod';

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const UlidSchema = z.string().regex(ULID_REGEX, 'must be a valid ULID');

export const EventTypeSchema = z.enum([
  'Plan',
  'Intent',
  'IntentStatus',
  'Decision',
  'Assumption',
  'Discovery',
  'Issue',
  'Question',
  'Artifact',
  'Revert',
  'HumanFeedback',
  'Checkpoint',
  'PlanComplete',
]);

export type EventType = z.infer<typeof EventTypeSchema>;

export const EventSchema = z.object({
  id: UlidSchema,
  project_id: z.string().min(1),
  session_id: UlidSchema,
  type: EventTypeSchema,
  created_at: z.string().datetime(),
  payload: z.unknown(),
});

export type Event = z.infer<typeof EventSchema>;
