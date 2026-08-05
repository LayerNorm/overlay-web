-- Automation graph model: add structured `graph` jsonb column to automations.
-- The graph column stores a versioned AutomationGraph ({ version, nodes[], edges[] })
-- as the source of truth for the visual editor. Existing rows are backfilled from
-- `graph_source` (Mermaid string) via a best-effort conversion done in application
-- code on first read (see resolveAutomationGraph). This migration only adds the
-- column; no SQL-level data conversion is needed because:
--   1. The app's resolveAutomationGraph() falls back to graphSource → graph
--      conversion at read time when graph is NULL.
--   2. Automations created after this migration persist the graph directly.
ALTER TABLE "automations" ADD COLUMN "graph" jsonb;--> statement-breakpoint
INSERT INTO overlay_app_data_metadata (key, value, updated_at)
VALUES
  ('schema_version', '43', now()),
  ('schema_min_compatible_version', '42', now())
ON CONFLICT (key) DO UPDATE
SET value = excluded.value, updated_at = excluded.updated_at;
