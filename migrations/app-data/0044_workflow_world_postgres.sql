-- Workflow SDK Postgres World: create the `workflow` schema with all tables
-- required by @workflow/world-postgres. This consolidated migration applies
-- the full set of schema changes from the world-postgres package (migrations
-- 0000 through 0015) in dependency order.
--
-- On Vercel deployments, these tables are unused (the Vercel World is used
-- automatically). On self-hosted deployments with WORKFLOW_TARGET_WORLD=
-- @workflow/world-postgres, the graphile-worker queue and event log are
-- stored here.
--
-- Idempotent: uses IF NOT EXISTS / IF NOT EXISTS equivalents so re-running
-- is safe.

-- 0000: Create schema, enums, and base tables
CREATE SCHEMA IF NOT EXISTS "workflow";--> statement-breakpoint

DO $$ BEGIN
 CREATE TYPE "public"."step_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
 CREATE TYPE "public"."status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow"."workflow_events" (
	"id" varchar PRIMARY KEY NOT NULL,
	"type" varchar NOT NULL,
	"correlation_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"run_id" varchar NOT NULL,
	"payload" jsonb
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow"."workflow_hooks" (
	"run_id" varchar NOT NULL,
	"hook_id" varchar PRIMARY KEY NOT NULL,
	"token" varchar NOT NULL,
	"owner_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"environment" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow"."workflow_runs" (
	"id" varchar PRIMARY KEY NOT NULL,
	"output" jsonb,
	"deployment_id" varchar NOT NULL,
	"status" "status" NOT NULL,
	"name" varchar NOT NULL,
	"execution_context" jsonb,
	"input" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"started_at" timestamp
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow"."workflow_steps" (
	"run_id" varchar NOT NULL,
	"step_id" varchar PRIMARY KEY NOT NULL,
	"step_name" varchar NOT NULL,
	"status" "step_status" NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"attempt" integer NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"retry_after" timestamp
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow"."workflow_stream_chunks" (
	"id" varchar NOT NULL,
	"stream_id" varchar NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"eof" boolean NOT NULL,
	CONSTRAINT "workflow_stream_chunks_stream_id_id_pk" PRIMARY KEY("stream_id","id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "workflow_events_run_id_index" ON "workflow"."workflow_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_events_correlation_id_index" ON "workflow"."workflow_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_hooks_run_id_index" ON "workflow"."workflow_hooks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_hooks_token_index" ON "workflow"."workflow_hooks" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_name_index" ON "workflow"."workflow_runs" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_status_index" ON "workflow"."workflow_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_steps_run_id_index" ON "workflow"."workflow_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_steps_status_index" ON "workflow"."workflow_steps" USING btree ("status");

-- 0001: Alter columns, add CBOR columns, drop error_code
ALTER TABLE "workflow"."workflow_runs" ALTER COLUMN "input" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow"."workflow_steps" ALTER COLUMN "input" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow"."workflow_events" ADD COLUMN IF NOT EXISTS "payload_cbor" "bytea";--> statement-breakpoint
ALTER TABLE "workflow"."workflow_hooks" ADD COLUMN IF NOT EXISTS "metadata_cbor" "bytea";--> statement-breakpoint
ALTER TABLE "workflow"."workflow_runs" ADD COLUMN IF NOT EXISTS "output_cbor" "bytea";--> statement-breakpoint
ALTER TABLE "workflow"."workflow_runs" ADD COLUMN IF NOT EXISTS "execution_context_cbor" "bytea";--> statement-breakpoint
ALTER TABLE "workflow"."workflow_runs" ADD COLUMN IF NOT EXISTS "input_cbor" "bytea";--> statement-breakpoint
ALTER TABLE "workflow"."workflow_steps" ADD COLUMN IF NOT EXISTS "input_cbor" "bytea";--> statement-breakpoint
ALTER TABLE "workflow"."workflow_steps" ADD COLUMN IF NOT EXISTS "output_cbor" "bytea";--> statement-breakpoint
ALTER TABLE "workflow"."workflow_runs" DROP COLUMN IF EXISTS "error_code";--> statement-breakpoint
ALTER TABLE "workflow"."workflow_steps" DROP COLUMN IF EXISTS "error_code";

-- 0002: Add expired_at
ALTER TABLE "workflow"."workflow_runs" ADD COLUMN IF NOT EXISTS "expired_at" timestamp;

-- 0003: Add stream run_id
ALTER TABLE "workflow"."workflow_stream_chunks" ADD COLUMN IF NOT EXISTS "run_id" varchar;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_stream_chunks_run_id_index" ON "workflow"."workflow_stream_chunks" USING btree ("run_id");

-- 0004: Remove paused status (already not in our enum, skip)

-- 0005: Add spec_version
ALTER TABLE "workflow"."workflow_runs" ADD COLUMN IF NOT EXISTS "spec_version" varchar;

-- 0006: Add error CBOR and spec_version columns
ALTER TABLE "workflow"."workflow_runs" ADD COLUMN IF NOT EXISTS "error_cbor" bytea;--> statement-breakpoint
ALTER TABLE "workflow"."workflow_steps" ADD COLUMN IF NOT EXISTS "error_cbor" bytea;--> statement-breakpoint
ALTER TABLE "workflow"."workflow_steps" ADD COLUMN IF NOT EXISTS "spec_version" integer;--> statement-breakpoint
ALTER TABLE "workflow"."workflow_hooks" ADD COLUMN IF NOT EXISTS "spec_version" integer;--> statement-breakpoint
ALTER TABLE "workflow"."workflow_events" ADD COLUMN IF NOT EXISTS "spec_version" integer;

-- 0007: Add waits table
DO $$ BEGIN
 CREATE TYPE "public"."wait_status" AS ENUM('waiting', 'completed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow"."workflow_waits" (
	"wait_id" varchar PRIMARY KEY NOT NULL,
	"run_id" varchar NOT NULL,
	"status" "wait_status" NOT NULL,
	"resume_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"spec_version" integer
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "workflow_waits_run_id_index" ON "workflow"."workflow_waits" USING btree ("run_id");

-- 0009: Add is_webhook
ALTER TABLE "workflow"."workflow_hooks" ADD COLUMN IF NOT EXISTS "is_webhook" boolean DEFAULT true;

-- 0010: Add unique index for entity creation events
WITH "ranked_workflow_events" AS (
	SELECT
		ctid,
		ROW_NUMBER() OVER (
			PARTITION BY "run_id", "correlation_id", "type"
			ORDER BY ctid
		) AS "row_num"
	FROM "workflow"."workflow_events"
	WHERE "type" IN ('step_created', 'hook_created', 'wait_created')
)
DELETE FROM "workflow"."workflow_events"
WHERE ctid IN (
	SELECT ctid
	FROM "ranked_workflow_events"
	WHERE "row_num" > 1
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_events_entity_creation_unique"
	ON "workflow"."workflow_events" ("run_id", "correlation_id", "type")
	WHERE "type" IN ('step_created', 'hook_created', 'wait_created');

-- 0015: Move enums to workflow schema (safe no-op if already there)
DO $$
DECLARE
  enum_name text;
  public_enum regtype;
  workflow_enum regtype;
  is_used_by_workflow_columns boolean;
  has_dependents_outside_workflow_tables boolean;
BEGIN
  FOREACH enum_name IN ARRAY ARRAY['status', 'step_status', 'wait_status'] LOOP
    public_enum := to_regtype(format('public.%I', enum_name));
    workflow_enum := to_regtype(format('workflow.%I', enum_name));

    IF public_enum IS NULL OR workflow_enum IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_depend dependency
      JOIN pg_class dependent_table
        ON dependency.classid = 'pg_class'::regclass AND dependency.objid = dependent_table.oid
      JOIN pg_namespace dependent_table_schema
        ON dependent_table_schema.oid = dependent_table.relnamespace
      WHERE dependency.refclassid = 'pg_type'::regclass
        AND dependency.refobjid = public_enum::oid
        AND dependency.objsubid > 0
        AND dependency.deptype != 'i'
        AND dependent_table_schema.nspname = 'workflow'
    ) INTO is_used_by_workflow_columns;

    IF NOT is_used_by_workflow_columns THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_depend dependency
      LEFT JOIN pg_class dependent_table
        ON dependency.classid = 'pg_class'::regclass AND dependency.objid = dependent_table.oid
      LEFT JOIN pg_namespace dependent_table_schema
        ON dependent_table_schema.oid = dependent_table.relnamespace
      WHERE dependency.refclassid = 'pg_type'::regclass
        AND dependency.refobjid = public_enum::oid
        AND dependency.deptype != 'i'
        AND NOT (
          dependency.classid = 'pg_class'::regclass
          AND dependent_table_schema.nspname = 'workflow'
        )
    ) INTO has_dependents_outside_workflow_tables;

    IF has_dependents_outside_workflow_tables THEN
      RAISE WARNING 'Skipping move of public.% to workflow schema because objects outside workflow tables depend on it', enum_name;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TYPE public.%I SET SCHEMA workflow', enum_name);
  END LOOP;
END $$;--> statement-breakpoint

INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES
  ('schema_version', '44', now()),
  ('schema_min_compatible_version', '43', now())
ON CONFLICT (key) DO UPDATE
SET value = excluded.value, updated_at = excluded.updated_at;
