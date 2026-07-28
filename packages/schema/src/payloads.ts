import { z } from 'zod';
import { PlanPayloadSchema } from './events/plan.js';
import { IntentPayloadSchema } from './events/intent.js';
import { IntentStatusPayloadSchema } from './events/intent-status.js';
import { DecisionPayloadSchema } from './events/decision.js';
import { QuestionPayloadSchema } from './events/question.js';
import { HumanFeedbackPayloadSchema } from './events/human-feedback.js';
import { ArtifactPayloadSchema } from './events/artifact.js';
import { CheckpointPayloadSchema } from './events/checkpoint.js';
import type { EventType } from './envelope.js';

// Phase 1 payload validators. Assumption/Discovery/Issue/Revert/PlanComplete
// are reserved names, deferred to Phase 2 (see plan-2-revised design deltas).
export const PayloadSchemaByType: Partial<Record<EventType, z.ZodTypeAny>> = {
  Plan: PlanPayloadSchema,
  Intent: IntentPayloadSchema,
  IntentStatus: IntentStatusPayloadSchema,
  Decision: DecisionPayloadSchema,
  Question: QuestionPayloadSchema,
  HumanFeedback: HumanFeedbackPayloadSchema,
  Artifact: ArtifactPayloadSchema,
  Checkpoint: CheckpointPayloadSchema,
};

export function validatePayload(type: EventType, payload: unknown): unknown {
  const schema = PayloadSchemaByType[type];
  if (!schema) {
    throw new Error(`No payload validator registered for event type: ${type}`);
  }
  return schema.parse(payload);
}
