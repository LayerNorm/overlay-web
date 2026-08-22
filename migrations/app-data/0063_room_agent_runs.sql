ALTER TYPE "overlay_agent_run_mode" ADD VALUE IF NOT EXISTS 'room';
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "agent_id" text;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "agent_principal_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_agent_principal_id_idx" ON "agent_runs" ("agent_principal_id");
