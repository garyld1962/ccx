import type { Digest, DriftReport, ProjectRow, EventRow } from '@ccx/storage';

export function formatDigest(d: Digest, projectName: string): string {
  const lines: string[] = [];
  lines.push(`# ccx digest — ${projectName}`);
  lines.push('');

  lines.push('## Current Plan');
  if (d.current_plan) {
    lines.push(`**[${d.current_plan.id}]** ${d.current_plan.title}`);
    lines.push(`Created: ${d.current_plan.created_at}`);
    lines.push('');
    lines.push(d.current_plan.summary);
  } else {
    lines.push('_no active plan_');
  }
  lines.push('');

  lines.push('## Open Intents');
  if (d.open_intents.length === 0) {
    lines.push('_none_');
  } else {
    for (const intent of d.open_intents) {
      const status = intent.status ?? '—';
      lines.push(`${intent.ordinal}. [${intent.id}] (${status}) ${intent.description}`);
    }
  }
  lines.push('');

  lines.push('## Recent Status Changes');
  if (d.recent_status_changes.length === 0) {
    lines.push('_none_');
  } else {
    for (const c of d.recent_status_changes) {
      lines.push(`- ${c.created_at} — ${c.status}: ${c.intent_description} [${c.intent_id}]`);
    }
  }
  lines.push('');

  lines.push('## Open Questions');
  if (d.open_questions.length === 0) lines.push('_none_');
  else for (const q of d.open_questions) lines.push(`- [${q.id}] ${q.question}`);
  lines.push('');

  lines.push('## Recent Decisions');
  if (d.recent_decisions.length === 0) lines.push('_none_');
  else for (const dec of d.recent_decisions) lines.push(`- [${dec.id}] ${dec.decision} — ${dec.rationale}`);
  lines.push('');

  lines.push('## Recent Human Feedback');
  if (d.recent_human_feedback.length === 0) lines.push('_none_');
  else for (const h of d.recent_human_feedback) lines.push(`- "${h.verbatim}" → ${h.interpreted_as}`);
  lines.push('');

  lines.push('## Last Checkpoint');
  if (d.last_checkpoint) {
    lines.push(`- ${d.last_checkpoint.created_at} @ ${d.last_checkpoint.git_commit_sha.slice(0, 12)} (${d.last_checkpoint.working_tree_clean ? 'clean' : 'dirty'}) — ${d.last_checkpoint.note}`);
  } else {
    lines.push('_none_');
  }
  lines.push('');

  lines.push('## Git State');
  lines.push(`- Branch: ${d.git.branch}`);
  lines.push(`- Commit: ${d.git.commitSha}`);
  lines.push(`- Working tree: ${d.git.workingTreeClean ? 'clean' : 'dirty'}`);
  lines.push('');

  lines.push('## Drift');
  if (d.drift.note) lines.push(`_${d.drift.note}_`);
  lines.push(`- Overclaimed completions: ${d.drift.overclaimed_count}`);
  for (const o of d.drift.overclaimed) {
    lines.push(`  - intent ${o.intent_id} claimed ${o.claimed_commit_sha} — ${o.reason}`);
  }

  return lines.join('\n');
}

export function formatBlocked(d: Digest): string {
  const lines: string[] = ['# ccx blocked', ''];
  lines.push('## Open Questions');
  if (d.open_questions.length === 0) lines.push('_none_');
  else for (const q of d.open_questions) {
    const blocks = q.blocks_intent_id ? ` (blocks ${q.blocks_intent_id})` : '';
    lines.push(`- ${q.created_at} [${q.id}]${blocks} — ${q.question}`);
  }
  lines.push('', '## Blocked Intents');
  const blockedIntents = d.open_intents.filter((i) => i.status === 'blocked');
  if (blockedIntents.length === 0) lines.push('_none_');
  else for (const i of blockedIntents) {
    lines.push(`- ${i.ordinal}. [${i.id}] ${i.description}`);
  }
  return lines.join('\n');
}

export function formatDrift(d: DriftReport): string {
  const lines: string[] = ['# ccx drift', ''];
  if (d.note) lines.push(`_${d.note}_`);
  lines.push(`Baseline checkpoint: ${d.baseline_commit_sha ?? '<none>'}`, '');
  if (d.overclaimed_count === 0) {
    lines.push('No overclaiming detected.');
  } else {
    lines.push(`OVERCLAIMED: ${d.overclaimed_count}`);
    for (const o of d.overclaimed) {
      lines.push(`- intent ${o.intent_id} claimed ${o.claimed_commit_sha} — ${o.reason}`);
    }
  }
  return lines.join('\n');
}

export function formatProjects(rows: ProjectRow[]): string {
  if (rows.length === 0) return '_no projects_';
  return rows
    .map((r) => `${r.name.padEnd(30)}  ${r.id}  (created ${r.createdAt.toISOString()})`)
    .join('\n');
}

export function formatTail(events: EventRow[]): string {
  return events
    .map(
      (e) =>
        `${e.createdAt.toISOString()}  ${e.type.padEnd(14)}  ${e.id}  ${JSON.stringify(e.payload)}`,
    )
    .join('\n');
}
