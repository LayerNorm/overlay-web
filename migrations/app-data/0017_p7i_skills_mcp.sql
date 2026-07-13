CREATE TYPE "public"."overlay_mcp_transport" AS ENUM('sse', 'streamable-http');--> statement-breakpoint
CREATE TYPE "public"."overlay_mcp_auth_type" AS ENUM('none', 'bearer', 'header');--> statement-breakpoint
CREATE TYPE "public"."overlay_mcp_tool_policy" AS ENUM('allow', 'approval_required', 'deny');--> statement-breakpoint
CREATE TYPE "public"."overlay_mcp_execution_status" AS ENUM('succeeded', 'failed', 'denied');--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"instructions" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"description" text,
	"transport" "overlay_mcp_transport" NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auth_type" "overlay_mcp_auth_type" DEFAULT 'none' NOT NULL,
	"encrypted_auth_config" text,
	"timeout_ms" integer,
	"default_tool_policy" "overlay_mcp_tool_policy" DEFAULT 'allow' NOT NULL,
	"tool_policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tool_catalog" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_catalog_updated_at" timestamp with time zone,
	"tool_catalog_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mcp_tool_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"mcp_server_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"arguments_hash" text NOT NULL,
	"policy_decision" "overlay_mcp_tool_policy" NOT NULL,
	"status" "overlay_mcp_execution_status" NOT NULL,
	"conversation_id" text,
	"turn_id" text,
	"model_id" text,
	"duration_ms" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_executions" ADD CONSTRAINT "mcp_tool_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_executions" ADD CONSTRAINT "mcp_tool_executions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_executions" ADD CONSTRAINT "mcp_tool_executions_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skills_user_updated_idx" ON "skills" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "skills_project_updated_idx" ON "skills" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "mcp_servers_user_updated_idx" ON "mcp_servers" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "mcp_servers_user_enabled_idx" ON "mcp_servers" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE INDEX "mcp_servers_project_updated_idx" ON "mcp_servers" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "mcp_tool_executions_user_created_idx" ON "mcp_tool_executions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_tool_executions_server_created_idx" ON "mcp_tool_executions" USING btree ("mcp_server_id","created_at");
