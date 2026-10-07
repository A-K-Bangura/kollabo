import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { ACTIVITY_ACTIONS, TASK_PRIORITIES, TASK_STATUSES } from '../../shared/constants.js'

export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES)
export const taskPriorityEnum = pgEnum('task_priority', TASK_PRIORITIES)
export const activityActionEnum = pgEnum('activity_action', ACTIVITY_ACTIONS)

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Keyed HMAC of the access code. The plain code is never stored. */
  accessCodeHash: text('access_code_hash').notNull().unique(),
  /** Bumped when the code is regenerated; sessions carrying an older value die. */
  sessionVersion: integer('session_version').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Members are never hard-deleted. Removing someone sets is_active = false, so
 * tasks and activity keep pointing at a real row with the right name.
 */
export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    // Target of the composite foreign keys below: lets other tables prove that
    // a member belongs to the same project as the row referencing it.
    unique('members_id_project_unique').on(table.id, table.projectId),
    uniqueIndex('members_project_name_unique').on(table.projectId, sql`lower(${table.name})`),
  ],
)

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('todo'),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    assignedToMemberId: uuid('assigned_to_member_id'),
    /** A calendar date (no time, no timezone), returned as 'YYYY-MM-DD'. */
    dueDate: date('due_date', { mode: 'string' }),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    createdAt: createdAt(),
    updatedByMemberId: uuid('updated_by_member_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Optimistic concurrency token. Every update must present the version it read. */
    version: integer('version').notNull().default(1),
    completedByMemberId: uuid('completed_by_member_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('tasks_id_project_unique').on(table.id, table.projectId),
    // Composite keys: a task can only reference members of its own project,
    // enforced by the database even if application code had a bug.
    foreignKey({
      name: 'tasks_assignee_fk',
      columns: [table.assignedToMemberId, table.projectId],
      foreignColumns: [members.id, members.projectId],
    }),
    foreignKey({
      name: 'tasks_created_by_fk',
      columns: [table.createdByMemberId, table.projectId],
      foreignColumns: [members.id, members.projectId],
    }),
    foreignKey({
      name: 'tasks_updated_by_fk',
      columns: [table.updatedByMemberId, table.projectId],
      foreignColumns: [members.id, members.projectId],
    }),
    foreignKey({
      name: 'tasks_completed_by_fk',
      columns: [table.completedByMemberId, table.projectId],
      foreignColumns: [members.id, members.projectId],
    }),
    check(
      'tasks_completion_consistent',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null) and (${table.completedAt} is null) = (${table.completedByMemberId} is null)`,
    ),
    index('tasks_project_status_idx').on(table.projectId, table.status),
    index('tasks_project_due_date_idx').on(table.projectId, table.dueDate),
  ],
)

/** Immutable history: rows are only ever inserted (and cascade away with their task). */
export const taskActivity = pgTable(
  'task_activity',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull(),
    memberId: uuid('member_id').notNull(),
    action: activityActionEnum('action').notNull(),
    fromStatus: taskStatusEnum('from_status'),
    toStatus: taskStatusEnum('to_status'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'task_activity_task_fk',
      columns: [table.taskId, table.projectId],
      foreignColumns: [tasks.id, tasks.projectId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'task_activity_member_fk',
      columns: [table.memberId, table.projectId],
      foreignColumns: [members.id, members.projectId],
    }),
    check(
      'task_activity_status_fields',
      sql`(${table.action} = 'status_changed') = (${table.fromStatus} is not null and ${table.toStatus} is not null)`,
    ),
    index('task_activity_task_idx').on(table.taskId, table.createdAt),
  ],
)

/** Fixed-window counters for throttling access-code guesses across serverless instances. */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
})

export const projectsRelations = relations(projects, ({ many }) => ({
  members: many(members),
  tasks: many(tasks),
}))

export const membersRelations = relations(members, ({ one }) => ({
  project: one(projects, { fields: [members.projectId], references: [projects.id] }),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  assignee: one(members, {
    fields: [tasks.assignedToMemberId],
    references: [members.id],
    relationName: 'assignee',
  }),
  activity: many(taskActivity),
}))

export const taskActivityRelations = relations(taskActivity, ({ one }) => ({
  task: one(tasks, { fields: [taskActivity.taskId], references: [tasks.id] }),
  member: one(members, { fields: [taskActivity.memberId], references: [members.id] }),
}))
