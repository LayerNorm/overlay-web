/**
 * Personal / Workspace / Archived scoping shared by files, notes, outputs, skills, MCP servers, connectors, and
 * automations. `personal` is "mine within this workspace"; `workspace` is shared with its members. Archived is a state:
 * an archived row keeps the scope it was archived from (`archivedFromScope`).
 */
export type ResourceScope = 'personal' | 'workspace'
export type ResourceView = ResourceScope | 'archived'

export interface ScopedResourceFields {
  /** Absent means personal. */
  scope?: ResourceScope
  archivedAt?: number
  archivedFromScope?: ResourceScope
}

export type ScopedResourceKind = 'files' | 'skills' | 'mcp-servers' | 'connectors' | 'automations'
export type ScopedResourceAction = 'move' | 'archive' | 'restore'

export interface ScopeActionRequest {
  resource: ScopedResourceKind
  id: string
  action: ScopedResourceAction
  /** Required for `move`. */
  to?: ResourceScope
}
