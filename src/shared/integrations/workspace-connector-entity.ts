/**
 * Workspace connectors are accounts linked on behalf of a workspace, not a person. The connector provider keys
 * connections by an "entity" id; for a workspace that id is derived from the workspace id, so the account is separate
 * from every member's personal ones, is never listed in anyone's personal connectors, and is untouched when a member
 * leaves or deletes their account.
 */
export function workspaceConnectorEntityId(workspaceId: string): string {
  return `ovws_${workspaceId}`
}

/** Prefix on the tool names of the workspace's accounts, so they sit beside the person's own without colliding. */
export const WORKSPACE_TOOL_PREFIX = 'workspace_'
