CREATE TYPE "public"."actor_type" AS ENUM('member', 'admin');--> statement-breakpoint
CREATE TYPE "public"."admin_account_status" AS ENUM('active', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."assignment_mode" AS ENUM('all', 'any');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'assignee_added';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'assignee_removed';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'assignee_status_changed';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'mode_changed';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'note_edited';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'note_cleared';--> statement-breakpoint
CREATE TABLE "admin_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" "admin_account_status" DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_by_admin_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivated_by_admin_id" text
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"admin_id" text NOT NULL,
	"admin_name" text NOT NULL,
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"project_id" uuid,
	"reason" text,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "admin_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "admin_two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "admin_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_member_id" uuid,
	"assigned_by_admin_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_member_id" uuid,
	"updated_by_admin_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "task_assignees_completion_consistent" CHECK (("task_assignees"."status" = 'completed') = ("task_assignees"."completed_at" is not null)),
	CONSTRAINT "task_assignees_actor" CHECK (("task_assignees"."updated_by_member_id" is null or "task_assignees"."updated_by_admin_id" is null) and ("task_assignees"."assigned_by_member_id" is null or "task_assignees"."assigned_by_admin_id" is null))
);
--> statement-breakpoint
CREATE TABLE "task_note_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"content" text,
	"is_clear" boolean DEFAULT false NOT NULL,
	"editor_type" "actor_type" NOT NULL,
	"editor_member_id" uuid,
	"editor_admin_id" text,
	"editor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_note_revisions_number_unique" UNIQUE("task_id","revision_number"),
	CONSTRAINT "task_note_revisions_clear_consistent" CHECK (("task_note_revisions"."content" is null) = "task_note_revisions"."is_clear"),
	CONSTRAINT "task_note_revisions_editor_actor" CHECK (("task_note_revisions"."editor_type" = 'member' and "task_note_revisions"."editor_member_id" is not null and "task_note_revisions"."editor_admin_id" is null) or ("task_note_revisions"."editor_type" = 'admin' and "task_note_revisions"."editor_admin_id" is not null and "task_note_revisions"."editor_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "task_activity" DROP CONSTRAINT "task_activity_status_fields";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_completion_consistent";--> statement-breakpoint
ALTER TABLE "task_activity" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "created_by_member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "updated_by_member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status" "project_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "plan_key" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "billing_status" text;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "admin_id" text;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "actor_type" "actor_type" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "actor_name" text;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "subject_member_id" uuid;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "subject_name" text;--> statement-breakpoint
ALTER TABLE "task_activity" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assignment_mode" "assignment_mode" DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "created_by_admin_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "updated_by_admin_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completed_by_admin_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "progress_note" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "progress_note_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "note_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "note_updated_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "note_updated_by_admin_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "note_updated_by_name" text;--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD CONSTRAINT "admin_accounts_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD CONSTRAINT "admin_accounts_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD CONSTRAINT "admin_accounts_deactivated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("deactivated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_auth_accounts" ADD CONSTRAINT "admin_auth_accounts_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_two_factors" ADD CONSTRAINT "admin_two_factors_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_assigned_by_admin_id_admin_users_id_fk" FOREIGN KEY ("assigned_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_updated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_member_fk" FOREIGN KEY ("member_id","project_id") REFERENCES "public"."members"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_assigned_by_fk" FOREIGN KEY ("assigned_by_member_id","project_id") REFERENCES "public"."members"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_updated_by_fk" FOREIGN KEY ("updated_by_member_id","project_id") REFERENCES "public"."members"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_note_revisions" ADD CONSTRAINT "task_note_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_note_revisions" ADD CONSTRAINT "task_note_revisions_editor_admin_id_admin_users_id_fk" FOREIGN KEY ("editor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_note_revisions" ADD CONSTRAINT "task_note_revisions_task_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_note_revisions" ADD CONSTRAINT "task_note_revisions_editor_fk" FOREIGN KEY ("editor_member_id","project_id") REFERENCES "public"."members"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_logs_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_project_idx" ON "admin_audit_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_admin_idx" ON "admin_audit_logs" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_auth_accounts_user_idx" ON "admin_auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "admin_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_two_factors_user_idx" ON "admin_two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_two_factors_secret_idx" ON "admin_two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "admin_verifications_identifier_idx" ON "admin_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "task_assignees_active_unique" ON "task_assignees" USING btree ("task_id","member_id") WHERE "task_assignees"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "task_assignees_member_idx" ON "task_assignees" USING btree ("project_id","member_id") WHERE "task_assignees"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "task_assignees_task_idx" ON "task_assignees" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_subject_fk" FOREIGN KEY ("subject_member_id","project_id") REFERENCES "public"."members"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("completed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_note_updated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("note_updated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_note_updated_by_fk" FOREIGN KEY ("note_updated_by_member_id","project_id") REFERENCES "public"."members"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "task_activity_project_created_idx" ON "task_activity" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "task_activity_created_idx" ON "task_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tasks_project_updated_idx" ON "tasks" USING btree ("project_id","updated_at");--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_status_pair" CHECK (("task_activity"."from_status" is null) = ("task_activity"."to_status" is null));--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_actor" CHECK (("task_activity"."actor_type" = 'member' and "task_activity"."member_id" is not null and "task_activity"."admin_id" is null) or ("task_activity"."actor_type" = 'admin' and "task_activity"."admin_id" is not null and "task_activity"."member_id" is null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_actor" CHECK (("tasks"."created_by_member_id" is not null) <> ("tasks"."created_by_admin_id" is not null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_actor" CHECK (("tasks"."updated_by_member_id" is not null) <> ("tasks"."updated_by_admin_id" is not null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_note_consistent" CHECK (("tasks"."progress_note_version" = 0) = ("tasks"."note_updated_at" is null) and ("tasks"."progress_note" is null or "tasks"."progress_note_version" > 0) and ("tasks"."note_updated_by_member_id" is null or "tasks"."note_updated_by_admin_id" is null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completion_consistent" CHECK (("tasks"."status" = 'completed') = ("tasks"."completed_at" is not null) and ("tasks"."completed_at" is null) = ("tasks"."completed_by_member_id" is null and "tasks"."completed_by_admin_id" is null) and ("tasks"."completed_by_member_id" is null or "tasks"."completed_by_admin_id" is null));