CREATE TABLE "authorization_roles" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);

CREATE UNIQUE INDEX "authorization_roles_name_idx"
  ON "authorization_roles" (lower("name"));
CREATE INDEX "authorization_roles_archived_at_idx"
  ON "authorization_roles" ("archived_at");

CREATE TABLE "authorization_groups" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "source" text DEFAULT 'local' NOT NULL,
  "external_id" text,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "authorization_groups_source_check"
    CHECK ("source" IN ('local', 'external'))
);

CREATE UNIQUE INDEX "authorization_groups_name_idx"
  ON "authorization_groups" (lower("name"));
CREATE UNIQUE INDEX "authorization_groups_external_idx"
  ON "authorization_groups" ("source", "external_id")
  WHERE "external_id" IS NOT NULL;
CREATE INDEX "authorization_groups_archived_at_idx"
  ON "authorization_groups" ("archived_at");

CREATE TABLE "authorization_group_memberships" (
  "group_id" text NOT NULL REFERENCES "authorization_groups"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source" text DEFAULT 'local' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "authorization_group_memberships_pk" PRIMARY KEY ("group_id", "user_id"),
  CONSTRAINT "authorization_group_memberships_source_check"
    CHECK ("source" IN ('local', 'external'))
);

CREATE INDEX "authorization_group_memberships_user_idx"
  ON "authorization_group_memberships" ("user_id");

CREATE TABLE "authorization_user_roles" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role_id" text NOT NULL REFERENCES "authorization_roles"("id") ON DELETE CASCADE,
  "assigned_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "authorization_user_roles_pk" PRIMARY KEY ("user_id", "role_id")
);

CREATE INDEX "authorization_user_roles_role_idx"
  ON "authorization_user_roles" ("role_id");

CREATE TABLE "authorization_group_roles" (
  "group_id" text NOT NULL REFERENCES "authorization_groups"("id") ON DELETE CASCADE,
  "role_id" text NOT NULL REFERENCES "authorization_roles"("id") ON DELETE CASCADE,
  "assigned_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "authorization_group_roles_pk" PRIMARY KEY ("group_id", "role_id")
);

CREATE INDEX "authorization_group_roles_role_idx"
  ON "authorization_group_roles" ("role_id");

CREATE TABLE "authorization_resource_grants" (
  "id" text PRIMARY KEY NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "principal_type" text NOT NULL,
  "principal_id" text NOT NULL,
  "access_role" text NOT NULL,
  "granted_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "authorization_resource_grants_principal_type_check"
    CHECK ("principal_type" IN ('user', 'group', 'role')),
  CONSTRAINT "authorization_resource_grants_access_role_check"
    CHECK ("access_role" IN ('viewer', 'editor', 'owner'))
);

CREATE UNIQUE INDEX "authorization_resource_grants_principal_idx"
  ON "authorization_resource_grants"
  ("resource_type", "resource_id", "principal_type", "principal_id");
CREATE INDEX "authorization_resource_grants_resource_idx"
  ON "authorization_resource_grants" ("resource_type", "resource_id");
CREATE INDEX "authorization_resource_grants_principal_lookup_idx"
  ON "authorization_resource_grants" ("principal_type", "principal_id", "resource_type");
