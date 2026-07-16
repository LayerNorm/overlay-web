CREATE TYPE "public"."overlay_auth_provider" AS ENUM('workos', 'better-auth', 'oidc', 'none');--> statement-breakpoint
CREATE TYPE "public"."overlay_chat_mode" AS ENUM('ask', 'act');--> statement-breakpoint
CREATE TYPE "public"."overlay_file_index_status" AS ENUM('pending', 'indexed', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."overlay_file_kind" AS ENUM('folder', 'note', 'upload', 'output');--> statement-breakpoint
CREATE TYPE "public"."overlay_file_type" AS ENUM('file', 'folder');--> statement-breakpoint
CREATE TYPE "public"."overlay_message_content_type" AS ENUM('text', 'image', 'video');--> statement-breakpoint
CREATE TYPE "public"."overlay_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."overlay_message_status" AS ENUM('generating', 'completed', 'error');--> statement-breakpoint
CREATE TYPE "public"."overlay_share_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TYPE "public"."overlay_upload_intent_status" AS ENUM('pending', 'finalized', 'expired');--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"provider" "overlay_auth_provider" NOT NULL,
	"subject" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_subject_pk" PRIMARY KEY("provider","subject")
);
--> statement-breakpoint
CREATE TABLE "conversation_context_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"summary" text NOT NULL,
	"summarized_through_message_id" text,
	"summarized_through_created_at" timestamp with time zone,
	"source_message_count" integer NOT NULL,
	"source_estimated_tokens" integer NOT NULL,
	"summary_estimated_tokens" integer NOT NULL,
	"context_window" integer NOT NULL,
	"target_model_id" text NOT NULL,
	"summarizer_model_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_message_deltas" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"text_delta" text,
	"new_parts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"role" "overlay_message_role" NOT NULL,
	"mode" "overlay_chat_mode" NOT NULL,
	"content" text NOT NULL,
	"content_type" "overlay_message_content_type" NOT NULL,
	"parts" jsonb,
	"model_id" text,
	"variant_index" integer,
	"tokens" jsonb,
	"reply_to_turn_id" text,
	"reply_snippet" text,
	"routed_model_id" text,
	"status" "overlay_message_status",
	"updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text,
	"title" text NOT NULL,
	"project_id" text,
	"last_modified" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_mode" "overlay_chat_mode" NOT NULL,
	"ask_model_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"act_model_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"share_token" text,
	"share_visibility" "overlay_share_visibility",
	"shared_at" timestamp with time zone,
	"is_automation" boolean
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "overlay_file_type" NOT NULL,
	"kind" "overlay_file_kind",
	"parent_id" text,
	"content" text,
	"text_content" text,
	"storage_id" text,
	"r2_key" text,
	"mime_type" text,
	"extension" text,
	"size_bytes" bigint,
	"content_hash" text,
	"duplicate_of_file_id" text,
	"indexable" boolean,
	"index_status" "overlay_file_index_status",
	"indexed_at" timestamp with time zone,
	"index_error" text,
	"conversation_id" text,
	"turn_id" text,
	"model_id" text,
	"prompt" text,
	"output_type" text,
	"legacy_note_id" text,
	"legacy_output_id" text,
	"project_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"share_token" text,
	"share_visibility" "overlay_share_visibility",
	"shared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text,
	"title" text NOT NULL,
	"icon" text,
	"content" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"project_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "onboarding_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"has_seen_onboarding" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text,
	"name" text NOT NULL,
	"instructions" text,
	"parent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "r2_upload_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"declared_size_bytes" bigint NOT NULL,
	"actual_size_bytes" bigint,
	"mime_type" text,
	"status" "overlay_upload_intent_status" NOT NULL,
	"file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"expired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"theme" text DEFAULT 'dark' NOT NULL,
	"light_theme_preset" text,
	"dark_theme_preset" text,
	"use_secondary_sidebar" boolean DEFAULT false NOT NULL,
	"chat_streaming_mode" text,
	"auto_continue" boolean,
	"default_chat_mode" "overlay_chat_mode",
	"model_preference" text,
	"default_ask_model_ids" jsonb,
	"default_act_model_id" text,
	"default_image_model_id" text,
	"default_video_model_id" text,
	"default_image_aspect_ratio" text,
	"default_video_aspect_ratio" text,
	"send_with_enter" boolean,
	"attach_files_to_knowledge_by_default" boolean,
	"only_allow_zdr_models" boolean,
	"dismissed_zdr_warning_globally" boolean,
	"dismissed_zdr_warning_model_ids" jsonb,
	"enabled_chat_model_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"first_name" text,
	"last_name" text,
	"profile_picture_url" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_context_summaries" ADD CONSTRAINT "conversation_context_summaries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_context_summaries" ADD CONSTRAINT "conversation_context_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_deltas" ADD CONSTRAINT "conversation_message_deltas_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_deltas" ADD CONSTRAINT "conversation_message_deltas_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message_deltas" ADD CONSTRAINT "conversation_message_deltas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_state" ADD CONSTRAINT "onboarding_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "r2_upload_intents" ADD CONSTRAINT "r2_upload_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "r2_upload_intents" ADD CONSTRAINT "r2_upload_intents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_identities_email_idx" ON "auth_identities" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_context_summaries_conversation_scope_idx" ON "conversation_context_summaries" USING btree ("conversation_id","scope");--> statement-breakpoint
CREATE INDEX "conversation_context_summaries_user_id_updated_at_idx" ON "conversation_context_summaries" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversation_message_deltas_conversation_id_idx" ON "conversation_message_deltas" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_message_deltas_message_id_idx" ON "conversation_message_deltas" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "conversation_message_deltas_user_id_idx" ON "conversation_message_deltas" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversation_message_deltas_created_at_idx" ON "conversation_message_deltas" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_id_idx" ON "conversation_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_user_id_idx" ON "conversation_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_created_at_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_status_updated_at_idx" ON "conversation_messages" USING btree ("conversation_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_status_updated_at_idx" ON "conversation_messages" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_turn_id_idx" ON "conversation_messages" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "conversations_user_id_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_user_id_client_id_idx" ON "conversations" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "conversations_user_id_last_modified_idx" ON "conversations" USING btree ("user_id","last_modified");--> statement-breakpoint
CREATE INDEX "conversations_user_id_updated_at_idx" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_project_id_idx" ON "conversations" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_share_token_idx" ON "conversations" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "files_user_id_idx" ON "files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "files_user_id_content_hash_idx" ON "files" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX "files_duplicate_of_file_id_idx" ON "files" USING btree ("duplicate_of_file_id");--> statement-breakpoint
CREATE INDEX "files_project_id_idx" ON "files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "files_parent_id_idx" ON "files" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "files_legacy_note_id_idx" ON "files" USING btree ("legacy_note_id");--> statement-breakpoint
CREATE INDEX "files_legacy_output_id_idx" ON "files" USING btree ("legacy_output_id");--> statement-breakpoint
CREATE INDEX "files_conversation_id_idx" ON "files" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "files_r2_key_idx" ON "files" USING btree ("r2_key");--> statement-breakpoint
CREATE UNIQUE INDEX "files_share_token_idx" ON "files" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "notes_user_id_idx" ON "notes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_user_id_client_id_idx" ON "notes" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "notes_user_id_updated_at_idx" ON "notes" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "notes_project_id_idx" ON "notes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_user_id_client_id_idx" ON "projects" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "projects_user_id_updated_at_idx" ON "projects" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "projects_parent_id_idx" ON "projects" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "r2_upload_intents_r2_key_idx" ON "r2_upload_intents" USING btree ("r2_key");--> statement-breakpoint
CREATE INDEX "r2_upload_intents_user_id_status_expires_at_idx" ON "r2_upload_intents" USING btree ("user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "r2_upload_intents_file_id_idx" ON "r2_upload_intents" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");