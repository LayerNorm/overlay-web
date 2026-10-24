# Workspace handle rollout

The workspace handle registry is an additive expansion: `workspaceId` remains the authorization identity, `slug` remains the current canonical handle, and `workspaceHandles` permanently reserves canonical and historical names. Never delete registry claims during rollback.

Scoped features use `/w/<handle>/<personal|workspace>/<feature>`, for example `/w/layernorm/personal/work` and `/w/layernorm/workspace/chat`. Summaries expose a routing handle only after member-scoped resolution confirms it belongs to the same immutable workspace. Until then, navigation stays on immutable workspace IDs; existing accounts remain usable without a migration or backfill. Solo workspaces retain both view scopes. Scope is a feature view, not an access grant; workspace membership and resource authorization remain authoritative. Activity is workspace-only.

## Expand and backfill

Protected server pages defer sign-in redirects to browser session recovery. A successful refresh reloads server content at the current address, retaining the workspace, scope, query and hash. Only a confirmed signed-out session opens the existing sign-in gate; transient failures use the page error boundary rather than changing the destination.

1. Keep handle writes disabled (`OVERLAY_WORKSPACE_HANDLE_WRITES_ENABLED=false`). Follow the release policy: merge the reviewed change, wait for matching native Git web production to be live, then deploy additive Convex from clean current canonical `main`. The new web readers tolerate a backend without the resolver and existing accounts continue with ID navigation; backfill is required only before enabling handle writes, not for continued account access. Feature worktrees may deploy only to their explicitly isolated PR backend, never shared development or customer production.
2. Preview the complete scan in bounded pages. Keep each returned cursor for the next preview call and confirm there are no conflicts, that personal proposals use opaque `personal-*` values, and that organization legacy slugs are retained when safe:

   ```sh
   npx convex run --prod migrations/workspaceHandles:previewWorkspaceHandlesBatchByServer \
     "{\"serverSecret\":\"$INTERNAL_API_SECRET\",\"paginationOpts\":{\"numItems\":50,\"cursor\":null}}"
   ```

3. Run a read-only migration dry run with `numItems` between 1 and 100. Review each batch and continue with the returned cursor. A personal handle proposal is random and may differ when the write batch allocates its final value:

   ```sh
   npx convex run --prod migrations/workspaceHandles:migrateWorkspaceHandlesBatchByServer \
     "{\"serverSecret\":\"$INTERNAL_API_SECRET\",\"dryRun\":true,\"paginationOpts\":{\"numItems\":50,\"cursor\":null}}"
   ```

4. After reviewing the complete dry run, apply batches without supplying a cursor; Convex's persisted migration cursor is authoritative. Repeat until the result reports `ready: true`. A supplied cursor that differs from persisted progress is rejected. Do not enable writes when any conflicts remain.

   ```sh
   npx convex run --prod migrations/workspaceHandles:migrateWorkspaceHandlesBatchByServer \
     "{\"serverSecret\":\"$INTERNAL_API_SECRET\"}"
   ```
5. Verify readiness with a fresh preview from `cursor:null`: every workspace must have a matching `canonical` / `public` registry claim and the current `slug`; old personal slugs must be `alias` / `private`. Re-run a dry run and confirm no row would change.

Run these production commands only from clean canonical `main` with explicitly scoped production credentials and approval for the data migration. The registry's `public` visibility means address resolution is permitted for authorized members, not that anonymous users can read or join a workspace. `private` legacy personal claims are reserved but never resolve. Random replacement proposals can differ between preview and allocation; unchanged valid organization handles remain stable.

## Enable and rollback

Deploy the web resolver/routing before enabling `OVERLAY_WORKSPACE_HANDLE_WRITES_ENABLED=true`. New web code works with the additive backend while the flag remains false; old web code continues using workspace IDs and ordinary workspace APIs. Enable the environment flag only after the full scan is ready and verified.

On rollback, disable handle writes in the web environment, but keep the additive schema, resolver, and all registry claims. Do not release aliases or revert the registry migration: already-shared `/w/:handle` links must continue resolving safely. No production migration or deployment is part of this change.
