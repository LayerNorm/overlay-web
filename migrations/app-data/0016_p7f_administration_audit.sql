CREATE TYPE "public"."overlay_administrative_role" AS ENUM('admin', 'auditor', 'billing_admin', 'support');--> statement-breakpoint
CREATE TYPE "public"."overlay_audit_actor_type" AS ENUM('user', 'api_key', 'service', 'system');--> statement-breakpoint
CREATE TYPE "public"."overlay_audit_outcome" AS ENUM('success', 'denied', 'failure');--> statement-breakpoint
CREATE TABLE "administrative_principals" (
  "user_id" text PRIMARY KEY NOT NULL,
  "role" "overlay_administrative_role" NOT NULL,
  "granted_by" text,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" text
);--> statement-breakpoint
CREATE TABLE "audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_type" "overlay_audit_actor_type" NOT NULL,
  "actor_user_id" text,
  "actor_api_key_id" text,
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text,
  "outcome" "overlay_audit_outcome" NOT NULL,
  "request_id" text,
  "ip_address" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "administrative_principals" ADD CONSTRAINT "administrative_principals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_api_key_id_api_keys_id_fk" FOREIGN KEY ("actor_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "administrative_principals_role_idx" ON "administrative_principals" ("role");--> statement-breakpoint
CREATE INDEX "administrative_principals_active_idx" ON "administrative_principals" ("revoked_at");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_created_idx" ON "audit_events" ("actor_user_id", "created_at");--> statement-breakpoint
CREATE INDEX "audit_events_action_created_idx" ON "audit_events" ("action", "created_at");--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" ("resource_type", "resource_id", "created_at");
