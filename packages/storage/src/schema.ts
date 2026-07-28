import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: text('id').primaryKey(), // first-commit SHA
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // ULID
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    host: text('host').notNull(),
    ccSessionId: text('cc_session_id'), // Claude Code session id (hook-created sessions)
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => ({
    ccSessionIdx: uniqueIndex('idx_sessions_cc_session').on(table.ccSessionId),
  }),
);

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(), // ULID
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectCreatedIdx: index('idx_events_project_created').on(
      table.projectId,
      table.createdAt.desc(),
    ),
    sessionIdx: index('idx_events_session').on(table.sessionId),
    typeIdx: index('idx_events_type').on(table.projectId, table.type),
  }),
);
