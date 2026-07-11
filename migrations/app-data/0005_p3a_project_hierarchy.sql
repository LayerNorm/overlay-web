ALTER TABLE "projects" ADD CONSTRAINT "projects_parent_id_projects_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_parent_not_self_check" CHECK ("projects"."parent_id" IS NULL OR "projects"."parent_id" <> "projects"."id");--> statement-breakpoint
INSERT INTO "overlay_app_data_metadata" ("key", "value")
VALUES
	('schema_version', '5'),
	('schema_min_compatible_version', '4')
ON CONFLICT ("key") DO UPDATE
SET
	"value" = EXCLUDED."value",
	"updated_at" = now();
