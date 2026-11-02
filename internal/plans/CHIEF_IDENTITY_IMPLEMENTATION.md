# Chief identity implementation

## Backend/contracts scope

This slice separates a user's global personal-chief appearance from executable agent bindings. The identity record contains only `name`, `description`, `avatarColor`, and `avatarShape`, keyed by `userId`. Workspace bindings retain their own instructions, tools, histories, threads, settings, and stable IDs. The thread API remains keyed by workspace, agent, and user.

Agent definitions expose optional `agentRole`, `chiefOwnerUserId`, and `chiefScope` metadata. Missing roles remain ordinary agents. `isDefault` remains a legacy runtime capability and is never inferred from a display name. Roles do not grant tools.

## Provisioning and migration

`ensureChiefsByServer` performs deterministic, atomic provisioning after verifying active human workspace membership. It adopts only explicit `isDefault` rows or the canonical `default-overlay-${workspaceId}` ID. Organization workspaces receive one workspace-chief binding and workspace-visible personal-chief bindings for active, non-guest human members. Personal workspaces keep the owner's personal-chief binding private and also receive the workspace-chief binding. Removed owners are omitted from directory results.

An adopted personal-workspace default keeps its binding ID and executable configuration; only its role/scope metadata and required private visibility are added. Its appearance fields bootstrap the global identity. Otherwise, the identity bootstraps from the account display name with the standard purple squircle appearance. Identity projection updates do not copy or modify executable settings or grants.

New personal-chief bindings receive the standard default agent tool groups as explicit IDs. They do not receive default-master wildcard authority. A workspace chief may retain the existing system-default capability; ordinary agents named “Overlay” receive no special role or authority.

## Ownership and visibility

Personal identity changes require the owner's active human principal at both the service and Convex boundaries. Appearance-only personal-chief PATCH requests use the identity mutation; binding configuration stays workspace-scoped. Personal-chief edits are owner-only, including against workspace administrators. Chief role/scope/owner metadata is server-managed, visibility and harness invariants are enforced, and chief bindings cannot be archived or deleted, including after rename. Private bindings are creator-visible; organization personal-chief bindings are workspace-visible but read-only to peers.

## Verification

Focused evidence belongs in `convex/chiefIdentity.convex.test.ts` and `src/server/agents/WorkspaceAgentService.test.ts`: idempotent concurrent ensure, conservative legacy adoption, global appearance projection, scoped thread isolation, owner visibility and edit authorization, removed-owner filtering, and duplicate personal names. This document records backend/contracts scope only; it does not claim UI completion, deployment, or hosted acceptance.
