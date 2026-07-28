import { z } from 'zod';

// Documented-stable common hook fields. Everything else passes through.
const HookInputSchema = z
  .object({
    session_id: z.string().min(1),
    cwd: z.string().min(1),
    hook_event_name: z.string().min(1),
  })
  .passthrough();

export type HookInput = z.infer<typeof HookInputSchema> & Record<string, unknown>;

export function parseHookInput(raw: string): HookInput {
  return HookInputSchema.parse(JSON.parse(raw)) as HookInput;
}

export async function readHookInput(stream: NodeJS.ReadableStream): Promise<HookInput> {
  let raw = '';
  stream.setEncoding('utf-8');
  for await (const chunk of stream) raw += chunk;
  return parseHookInput(raw);
}

// ---- Per-event field mapping. Paths verified against docs/hook-payloads.md. ----

export function toolName(input: HookInput): string | null {
  const t = input.tool_name;
  return typeof t === 'string' ? t : null;
}

export function toolFilePath(input: HookInput): string | null {
  const ti = input.tool_input as Record<string, unknown> | undefined;
  const p = ti?.file_path ?? ti?.notebook_path;
  return typeof p === 'string' ? p : null;
}

export function taskFields(input: HookInput): { taskId: string; subject: string } | null {
  // Task fields are FLAT on the payload — no nested `.task` object.
  // See docs/hook-payloads.md.
  const taskId = input.task_id;
  const subject = input.task_subject ?? input.task_description;
  if (typeof taskId !== 'string' || typeof subject !== 'string') return null;
  return { taskId, subject };
}
