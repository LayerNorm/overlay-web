ALTER TABLE "usage_reservations" ADD COLUMN "provider_work_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "reconciliation_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "reconciliation_last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "reconciliation_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "reconciliation_resolution" text;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "reconciliation_evidence_source" text;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "reconciliation_evidence_reference" text;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "reconciliation_reason" text;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_reconciliation_resolution_check" CHECK (
  "reconciliation_resolution" IS NULL OR
  "reconciliation_resolution" IN ('finalized', 'released')
);--> statement-breakpoint
CREATE INDEX "usage_reservations_status_updated_idx" ON "usage_reservations" USING btree ("status", "updated_at");
