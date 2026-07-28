import { McpServer, type ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ShapeOutput, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { postPlan, postPlanInputShape } from './tools/post-plan.js';
import { postIntent, postIntentInputShape } from './tools/post-intent.js';
import { postIntentStatus, postIntentStatusInputShape } from './tools/post-intent-status.js';
import { digest } from './tools/digest.js';
import { postDecision, postDecisionInputShape } from './tools/post-decision.js';
import { postQuestion, postQuestionInputShape } from './tools/post-question.js';
import { postHumanFeedback, postHumanFeedbackInputShape } from './tools/post-human-feedback.js';
import { query, queryInputShape } from './tools/query.js';
import { driftCheck } from './tools/drift-check.js';

function jsonTool<Shape extends ZodRawShapeCompat>(
  server: McpServer,
  name: string,
  description: string,
  shape: Shape,
  handler: (args: ShapeOutput<Shape>) => Promise<unknown>,
): void {
  // BaseToolCallback<_, _, Shape> is a conditional type that TS cannot resolve for a
  // generic Shape, so one internal cast is needed; the exported signature above keeps
  // shape and handler compile-time linked, which is what call sites rely on.
  const cb = async (args: ShapeOutput<Shape>) => {
    const result = await handler(args);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
  };
  server.tool(name, description, shape, cb as unknown as ToolCallback<Shape>);
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'ccx', version: '0.0.0' });

  server.tool(
    'ccx_post_plan',
    'Post a Plan event. Use when the user agrees to a multi-step plan.',
    postPlanInputShape,
    async (args) => {
      const result = await postPlan(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'ccx_post_intent',
    'Post an Intent (a step within a Plan).',
    postIntentInputShape,
    async (args) => {
      const result = await postIntent(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'ccx_post_intent_status',
    'Post a status change for an Intent. verification REQUIRED for completed; reason REQUIRED for blocked/abandoned.',
    postIntentStatusInputShape,
    async (args) => {
      const result = await postIntentStatus(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'ccx_digest',
    'Read the resume digest for the current project. Call this first when starting work.',
    {},
    async () => {
      const result = await digest();
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  jsonTool(server, 'ccx_post_decision', 'Post a Decision (durable choice future sessions would otherwise re-derive).', postDecisionInputShape, postDecision);
  jsonTool(server, 'ccx_post_question', 'Post a Question. Use when stuck pending human input — then stop work.', postQuestionInputShape, postQuestion);
  jsonTool(server, 'ccx_post_human_feedback', 'Post HumanFeedback (verbatim user steering/correction that matters on resume).', postHumanFeedbackInputShape, postHumanFeedback);
  jsonTool(server, 'ccx_query', 'Raw event read with optional type/session_id/limit filters.', queryInputShape, query);
  jsonTool(server, 'ccx_drift_check', 'Reconcile completion claims against git history since the last Checkpoint.', {}, driftCheck);

  return server;
}
