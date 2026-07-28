import { z } from 'zod';

export const CheckpointPayloadSchema = z.object({
  git_branch: z.string().min(1),
  git_commit_sha: z.string().min(1),
  working_tree_clean: z.boolean(),
  last_test_command: z.string().nullable(),
  last_test_exit_code: z.number().int().nullable(),
  note: z.string().min(1).max(300),
});

export type CheckpointPayload = z.infer<typeof CheckpointPayloadSchema>;
