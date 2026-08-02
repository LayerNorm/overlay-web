-- Web, connector, and cloud-drive knowledge sources. ADD VALUE IF NOT EXISTS is
-- transactional-safe on PostgreSQL 12+ and leaves existing values untouched, so
-- a rollback to schema 23 keeps working as long as no row uses a new value.
ALTER TYPE "overlay_canonical_knowledge_source_kind" ADD VALUE IF NOT EXISTS 'url';
--> statement-breakpoint
ALTER TYPE "overlay_canonical_knowledge_source_kind" ADD VALUE IF NOT EXISTS 'connector';
--> statement-breakpoint
ALTER TYPE "overlay_canonical_knowledge_source_kind" ADD VALUE IF NOT EXISTS 'drive';
