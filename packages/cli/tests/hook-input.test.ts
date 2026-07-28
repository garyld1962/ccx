import { describe, it, expect } from 'vitest';
import { parseHookInput, toolFilePath, toolName, taskFields } from '../src/hook-input.js';

const BASE = { session_id: 'cc-1', cwd: '/repo', hook_event_name: 'PostToolUse' };

describe('parseHookInput', () => {
  it('parses the documented common fields and preserves extras', () => {
    const input = parseHookInput(JSON.stringify({ ...BASE, tool_name: 'Edit' }));
    expect(input.session_id).toBe('cc-1');
    expect(input.cwd).toBe('/repo');
  });

  it('rejects payloads missing session_id', () => {
    expect(() => parseHookInput(JSON.stringify({ cwd: '/repo', hook_event_name: 'X' }))).toThrow();
  });
});

describe('toolFilePath / toolName', () => {
  it('extracts file_path for Write/Edit and notebook_path for NotebookEdit', () => {
    const edit = parseHookInput(JSON.stringify({ ...BASE, tool_name: 'Edit', tool_input: { file_path: '/repo/src/a.ts' } }));
    expect(toolFilePath(edit)).toBe('/repo/src/a.ts');
    expect(toolName(edit)).toBe('Edit');

    const nb = parseHookInput(JSON.stringify({ ...BASE, tool_name: 'NotebookEdit', tool_input: { notebook_path: '/repo/n.ipynb' } }));
    expect(toolFilePath(nb)).toBe('/repo/n.ipynb');
  });

  it('returns null when absent', () => {
    const input = parseHookInput(JSON.stringify({ ...BASE }));
    expect(toolFilePath(input)).toBeNull();
    expect(toolName(input)).toBeNull();
  });
});

describe('taskFields', () => {
  it('extracts task id and subject from flat fields', () => {
    const input = parseHookInput(JSON.stringify({
      ...BASE, hook_event_name: 'TaskCreated', task_id: '1', task_subject: 'alpha step', task_description: 'alpha step',
    }));
    expect(taskFields(input)).toEqual({ taskId: '1', subject: 'alpha step' });
  });

  it('falls back to task_description when task_subject is missing', () => {
    const input = parseHookInput(JSON.stringify({
      ...BASE, hook_event_name: 'TaskCreated', task_id: '2', task_description: 'beta step',
    }));
    expect(taskFields(input)).toEqual({ taskId: '2', subject: 'beta step' });
  });

  it('returns null when task fields are missing', () => {
    const input = parseHookInput(JSON.stringify({ ...BASE, hook_event_name: 'TaskCreated' }));
    expect(taskFields(input)).toBeNull();
  });
});
