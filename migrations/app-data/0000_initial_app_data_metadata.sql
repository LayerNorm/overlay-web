CREATE TABLE IF NOT EXISTS "overlay_app_data_metadata" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

INSERT INTO "overlay_app_data_metadata" ("key", "value")
VALUES ('schema_kind', 'overlay-app-data')
ON CONFLICT ("key") DO UPDATE
SET
  "value" = EXCLUDED."value",
  "updated_at" = now();
