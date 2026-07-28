#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runDigest } from './commands/digest.js';
import { runTail } from './commands/tail.js';
import { runHook } from './commands/hook.js';
import { runBlocked } from './commands/blocked.js';
import { runDrift } from './commands/drift.js';
import { runReplay } from './commands/replay.js';
import { runProjects } from './commands/projects.js';

const program = new Command();
program.name('ccx').description('Claude Code event log').version('0.0.0');

program
  .command('init')
  .description('Initialise .ccx/project.toml in the current repo')
  .action(async () => {
    try {
      await runInit();
    } catch (err) {
      process.stderr.write(`ccx init failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('digest')
  .description('Print the resume digest for the current project')
  .action(async () => {
    try {
      await runDigest();
    } catch (err) {
      process.stderr.write(`ccx digest failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('tail')
  .description('Print the last N events (default 20), newest first')
  .option('-n, --limit <n>', 'number of events', (v) => parseInt(v, 10), 20)
  .action(async (opts: { limit: number }) => {
    try {
      await runTail({ limit: opts.limit });
    } catch (err) {
      process.stderr.write(`ccx tail failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('hook')
  .description('Internal: invoked by Claude Code hooks; reads hook JSON on stdin, always exits 0')
  // Optional argument + excess args allowed: commander must never be able to
  // exit non-zero before runHook enforces the fail-soft exit-0 invariant.
  .argument('[event]', 'session-start|session-end|task-created|task-completed|post-tool-use')
  .allowExcessArguments(true)
  .allowUnknownOption(true)
  .action(async (event: string | undefined) => {
    await runHook(event);
  });

program
  .command('blocked')
  .description('Print open Questions and blocked Intents for the current project')
  .action(async () => {
    try { await runBlocked(); }
    catch (err) {
      process.stderr.write(`ccx blocked failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('drift')
  .description('Reconcile completion claims against git since the last Checkpoint. Exits 2 if drift detected.')
  .action(async () => {
    try { await runDrift(); }
    catch (err) {
      process.stderr.write(`ccx drift failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('replay')
  .description('Print the full event stream for a session, oldest first')
  .argument('<session_id>', 'session ULID')
  .action(async (sessionId: string) => {
    try { await runReplay(sessionId); }
    catch (err) {
      process.stderr.write(`ccx replay failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program
  .command('projects')
  .description('List all projects in the database')
  .action(async () => {
    try { await runProjects(); }
    catch (err) {
      process.stderr.write(`ccx projects failed: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`ccx fatal: ${err}\n`);
  process.exit(1);
});
