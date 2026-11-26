import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import {
  ACTIVITY_ACTIONS,
  ACTOR_TYPES,
  ASSIGNMENT_MODES,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../../shared/constants.js'

export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES)
export const taskPriorityEnum = pgEnum('task_priority', TASK_PRIORITIES)
export const activityActionEnum = pgEnum('activity_action', ACTIVITY_ACTIONS)
export const assignmentModeEnum = pgEnum('assignment_mode', ASSIGNMENT_MODES)
export const projectStatusEnum = pgEnum('project_status', PROJECT_STATUSES)
export const actorTypeEnum = pgEnum('actor_type', ACTOR_TYPES)
export const adminAccountStatusEnum = pgEnum('admin_account_status', ['active', 'deactivated'])

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

/* -------------------------------------------------------------------------- */
/* Platform administrators                                                    */
/*                                                                            */
/* Completely separate from project access codes. The first five tables are   */
/* owned by Better Auth (the maintained auth library); their shapes follow    */
/* what it requires. `admin_accounts` is Collabo's own status record.         */
/* -------------------------------------------------------------------------- */

export const adminUsers = pgTable('admin_users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  twoFactorEnabled: boolean('two_factor_enabled').default(false),
})

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
  },
  (table) => [index('admin_sessions_user_idx').on(table.userId)],
)

/** Better Auth's "account" model: holds the password hash for email + password sign-in. */
export const adminAuthAccounts = pgTable(
  'admin_auth_accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('admin_auth_accounts_user_idx').on(table.userId)],
)

export const adminVerifications = pgTable(
  'admin_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('admin_verifications_identifier_idx').on(table.identifier)],
)

/** TOTP secret (encrypted by Better Auth) and hashed backup codes. */
export const adminTwoFactors = pgTable(
  'admin_two_factors',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (table) => [
    index('admin_two_factors_user_idx').on(table.userId),
    index('admin_two_factors_secret_idx').on(table.secret),
  ],
)

/**
 * Collabo's own record per administrator. An admin who is `deactivated` cannot
 * use the admin API even if a session somehow survives, and must change an
 * initial password before doing anything else when `must_change_password` is set.
 */
export const adminAccounts = pgTable('admin_accounts', {
  userId: text('user_id')
    .primaryKey()
    .references(() => adminUsers.id, { onDelete: 'cascade' }),
  status: adminAccountStatusEnum('status').notNull().default('active'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdByAdminId: text('created_by_admin_id').references(() => adminUsers.id),
  createdAt: createdAt(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  deactivatedByAdminId: text('deactivated_by_admin_id').references(() => adminUsers.id),
})

/* -------------------------------------------------------------------------- */
/* Projects and members                                                       */
/* -------------------------------------------------------------------------- */

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Keyed HMAC of the access code. The plain code is never stored. */
    accessCodeHash: text('access_code_hash').notNull().unique(),
    /** Bumped when the code is regenerated; sessions carrying an older value die. */
    sessionVersion: integer('session_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * active: normal. suspended: ordinary sessions are refused (423). deleted: a
     * soft delete, invisible to ordinary access and recoverable by an admin.
     */
    status: projectStatusEnum('status').notNull().default('active'),
    /** Kept when a suspended project is soft-deleted, so recovery restores the right state. */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Informational only. Nothing in Collabo enforces plans or billing. */
    planKey: text('plan_key').notNull().default('free'),
    billingStatus: text('billing_status'),
  },
  (table) => [index('projects_status_idx').on(table.status)],
)

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
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (table) => [
    // Target of the composite foreign keys below: lets other tables prove that
    // a member belongs to the same project as the row referencing it.
    unique('members_id_project_unique').on(table.id, table.projectId),
    uniqueIndex('members_project_name_unique').on(table.projectId, sql`lower(${table.name})`),
  ],
)

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    /** The aggregate status, maintained transactionally from the assignees (see shared/task-progress.ts). */
    status: taskStatusEnum('status').notNull().default('todo'),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    /**
     * V1's single assignee. No longer read: `task_assignees` is the source of truth.
     * It is still kept equal to the first active assignee so an application
     * rollback to V1 keeps showing sensible data. Drop it in a later release.
     */
    assignedToMemberId: uuid('assigned_to_member_id'),
    /** A calendar date (no time, no timezone), returned as 'YYYY-MM-DD'. */
    dueDate: date('due_date', { mode: 'string' }),
    assignmentMode: assignmentModeEnum('assignment_mode').notNull().default('all'),

    // Who created / last changed the task. Exactly one of member / admin.
    createdByMemberId: uuid('created_by_member_id'),
    createdByAdminId: text('created_by_admin_id').references(() => adminUsers.id),
    createdAt: createdAt(),
    updatedByMemberId: uuid('updated_by_member_id'),
    updatedByAdminId: text('updated_by_admin_id').references(() => adminUsers.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Increases on every change. Group-level edits must present the version they read. */
    version: integer('version').notNull().default(1),

    // Completion of the *task* (all assignees, or the group in ANY mode).
    completedByMemberId: uuid('completed_by_member_id'),
    completedByAdminId: text('completed_by_admin_id').references(() => adminUsers.id),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // The one shared progress note. Every actual change also writes an immutable revision.
    progressNote: text('progress_note'),
    /** 0 = never written. Equals the number of the latest revision. */
    progressNoteVersion: integer('progress_note_version').notNull().default(0),
    noteUpdatedAt: timestamp('note_updated_at', { withTimezone: true }),
    noteUpdatedByMemberId: uuid('note_updated_by_member_id'),
    noteUpdatedByAdminId: text('note_updated_by_admin_id').references(() => adminUsers.id),
    noteUpdatedByName: text('note_updated_by_name'),
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
    foreignKey({
      name: 'tasks_note_updated_by_fk',
      columns: [table.noteUpdatedByMemberId, table.projectId],
      foreignColumns: [members.id, members.projectId],
    }),
    check(
      'tasks_created_by_actor',
      sql`(${table.createdByMemberId} is not null) <> (${table.createdByAdminId} is not null)`,
    ),
    check(
      'tasks_updated_by_actor',
      sql`(${table.updatedByMemberId} is not null) <> (${table.updatedByAdminId} is not null)`,
    ),
    check(
      'tasks_completion_consistent',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null) and (${table.completedAt} is null) = (${table.completedByMemberId} is null and ${table.completedByAdminId} is null) and (${table.completedByMemberId} is null or ${table.completedByAdminId} is null)`,
    ),
    check(
      'tasks_note_consistent',
      sql`(${table.progressNoteVersion} = 0) = (${table.noteUpdatedAt} is null) and (${table.progressNote} is null or ${table.progressNoteVersion} > 0) and (${table.noteUpdatedByMemberId} is null or ${table.noteUpdatedByAdminId} is null)`,
    ),
    index('tasks_project_status_idx').on(table.projectId, table.status),
    index('tasks_project_due_date_idx').on(table.projectId, table.dueDate),
    index('tasks_project_updated_idx').on(table.projectId, table.updatedAt),
  ],
)

/**
 * One row per assignment of a member to a task. Removing someone sets
 * `removed_at` instead of deleting, so progress history survives; re-adding
 * the same member later starts a fresh row.
 */
export const taskAssignees = pgTable(
  'task_assignees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull(),
    memberId: uuid('member_id').notNull(),
    /** This member's own progress. In ANY mode, `completed` means they ended the task for the group. */
    status: taskStatusEnum('status').notNull().default('todo'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedByMemberId: uuid('assigned_by_member_id'),
    assignedByAdminId: text('assigned_by_admin_id').references(() => adminUsers.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedByMemberId: uuid('updated_by_member_id'),
    updatedByAdminId: text('updated_by_admin_id').references(() => adminUsers.id),
    /** Optimistic-concurrency token for this assignee's own progress. */
    version: integer('version').notNull().default(1),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'task_assignees_task_fk',
      columns: [table.taskId, table.projectId],
      foreignColumns: [tasks.id, tasks.projectId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'task_assignees_member_fk',
      columns: [table.memberId, table.projectId],
      foreignColumns: [members.id, members.projectId],
    }),
    foreignKey({
      name: 'task_assignees_assigned_by_fk',
      columns: [table.assignedByMemberId, table.projectId],
      foreignColumns: [members.id, members.projectId],
    }),
    foreignKey({
      name: 'task_assignees_updated_by_fk',
      columns: [table.updatedByMemberId, table.projectId],
      foreignColumns: [members.id, members.projectId],
    }),
    // A member can be actively assigned to a task once; removed rows are history.
    uniqueIndex('task_assignees_active_unique')
      .on(table.taskId, table.memberId)
      .where(sql`${table.removedAt} is null`),
    index('task_assignees_member_idx')
      .on(table.projectId, table.memberId)
      .where(sql`${table.removedAt} is null`),
    index('task_assignees_task_idx').on(table.taskId),
    check(
      'task_assignees_completion_consistent',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`,
    ),
    check(
      'task_assignees_actor',
      sql`(${table.updatedByMemberId} is null or ${table.updatedByAdminId} is null) and (${table.assignedByMemberId} is null or ${table.assignedByAdminId} is null)`,
    ),
  ],
)

/**
 * Immutable history of the shared progress note. A row is added for every
 * actual change; content is null (and is_clear true) for a deliberate clear.
 */
export const taskNoteRevisions = pgTable(
  'task_note_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    content: text('content'),
    isClear: boolean('is_clear').notNull().default(false),
    editorType: actorTypeEnum('editor_type').notNull(),
    editorMemberId: uuid('editor_member_id'),
    editorAdminId: text('editor_admin_id').references(() => adminUsers.id),
    /** The editor's name at the time, so history stays readable after renames. */
    editorName: text('editor_name').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'task_note_revisions_task_fk',
      columns: [table.taskId, table.projectId],
      foreignColumns: [tasks.id, tasks.projectId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'task_note_revisions_editor_fk',
      columns: [table.editorMemberId, table.projectId],
      foreignColumns: [members.id, members.projectId],
    }),
    unique('task_note_revisions_number_unique').on(table.taskId, table.revisionNumber),
    check('task_note_revisions_clear_consistent', sql`(${table.content} is null) = ${table.isClear}`),
    check(
      'task_note_revisions_editor_actor',
      sql`(${table.editorType} = 'member' and ${table.editorMemberId} is not null and ${table.editorAdminId} is null) or (${table.editorType} = 'admin' and ${table.editorAdminId} is not null and ${table.editorMemberId} is null)`,
    ),
  ],
)

/** Append-only task history (a trigger rejects updates; rows go away only with their task). */
export const taskActivity = pgTable(
  'task_activity',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull(),
    /** The acting member (null when an admin acted). */
    memberId: uuid('member_id'),
    adminId: text('admin_id').references(() => adminUsers.id),
    actorType: actorTypeEnum('actor_type').notNull().default('member'),
    /** The actor's name at the time. Null only on rows that predate V2 (backfilled from members). */
    actorName: text('actor_name'),
    action: activityActionEnum('action').notNull(),
    /** The member this event is about (the assignee added, removed or progressing). */
    subjectMemberId: uuid('subject_member_id'),
    subjectName: text('subject_name'),
    fromStatus: taskStatusEnum('from_status'),
    toStatus: taskStatusEnum('to_status'),
    /** Small, secret-free context: modes, revision numbers, the reason an admin gave. */
    details: jsonb('details'),
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
    foreignKey({
      name: 'task_activity_subject_fk',
      columns: [table.subjectMemberId, table.projectId],
      foreignColumns: [members.id, members.projectId],
    }),
    check('task_activity_status_pair', sql`(${table.fromStatus} is null) = (${table.toStatus} is null)`),
    check(
      'task_activity_actor',
      sql`(${table.actorType} = 'member' and ${table.memberId} is not null and ${table.adminId} is null) or (${table.actorType} = 'admin' and ${table.adminId} is not null and ${table.memberId} is null)`,
    ),
    index('task_activity_task_idx').on(table.taskId, table.createdAt),
    index('task_activity_project_created_idx').on(table.projectId, table.createdAt),
    index('task_activity_created_idx').on(table.createdAt),
  ],
)

/**
 * Append-only record of privileged admin actions (triggers reject UPDATE and
 * DELETE). `summary` holds a small before/after description and never secrets
 * or raw access codes.
 */
export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    adminId: text('admin_id')
      .notNull()
      .references(() => adminUsers.id),
    adminName: text('admin_name').notNull(),
    adminEmail: text('admin_email').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    projectId: uuid('project_id').references(() => projects.id),
    reason: text('reason'),
    summary: jsonb('summary'),
    createdAt: createdAt(),
  },
  (table) => [
    index('admin_audit_logs_created_idx').on(table.createdAt),
    index('admin_audit_logs_project_idx').on(table.projectId, table.createdAt),
    index('admin_audit_logs_admin_idx').on(table.adminId, table.createdAt),
  ],
)

/** Fixed-window counters for throttling access-code guesses and admin logins across serverless instances. */
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
  assignees: many(taskAssignees),
  activity: many(taskActivity),
  revisions: many(taskNoteRevisions),
}))

export const taskAssigneesRelations = relations(taskAssignees, ({ one }) => ({
  task: one(tasks, { fields: [taskAssignees.taskId], references: [tasks.id] }),
  member: one(members, { fields: [taskAssignees.memberId], references: [members.id] }),
}))

export const taskActivityRelations = relations(taskActivity, ({ one }) => ({
  task: one(tasks, { fields: [taskActivity.taskId], references: [tasks.id] }),
  member: one(members, { fields: [taskActivity.memberId], references: [members.id] }),
}))

export const taskNoteRevisionsRelations = relations(taskNoteRevisions, ({ one }) => ({
  task: one(tasks, { fields: [taskNoteRevisions.taskId], references: [tasks.id] }),
}))
