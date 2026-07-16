WITH ranked_upload_intents AS (
	SELECT
		id,
		row_number() OVER (
			PARTITION BY r2_key
			ORDER BY
				CASE status WHEN 'finalized' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
				created_at DESC,
				id DESC
		) AS duplicate_rank
	FROM r2_upload_intents
)
DELETE FROM r2_upload_intents
WHERE id IN (
	SELECT id FROM ranked_upload_intents WHERE duplicate_rank > 1
);--> statement-breakpoint
DROP INDEX "r2_upload_intents_r2_key_idx";--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_parent_id_files_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_duplicate_of_file_id_files_id_fk" FOREIGN KEY ("duplicate_of_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "r2_upload_intents_r2_key_idx" ON "r2_upload_intents" USING btree ("r2_key");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_parent_not_self_check" CHECK ("files"."parent_id" IS NULL OR "files"."parent_id" <> "files"."id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_duplicate_not_self_check" CHECK ("files"."duplicate_of_file_id" IS NULL OR "files"."duplicate_of_file_id" <> "files"."id");--> statement-breakpoint
INSERT INTO "overlay_app_data_metadata" ("key", "value")
VALUES
	('schema_version', '6'),
	('schema_min_compatible_version', '5')
ON CONFLICT ("key") DO UPDATE
SET
	"value" = EXCLUDED."value",
	"updated_at" = now();
