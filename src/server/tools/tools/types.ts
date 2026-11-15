import 'server-only'

import type { ArtifactPublicationAuthority } from '@/server/files/ArtifactPublicationAuthority'
export type { ToolCategory } from '@overlay/tools-core'

/**
 * Unified overlay-native tools (Act agent). See build.ts for composition.
 *
 * Composio tools are merged in act/route.ts.
 */

/** Where a computer tool runs. */
export type ComputerTarget = 'cloud' | 'local'

export interface OverlayToolsOptions {
  userId: string
  accessToken?: string
  serverSecret?: string
  conversationId?: string
  turnId?: string
  automationId?: string
  approvalMode?: 'ask' | 'auto'
  /**
   * Where computer tools run when a call names no target: the cloud Computer or
   * the user's own connected Mac. Unset prefers the cloud Computer and falls back
   * to the Mac.
   */
  computerTarget?: ComputerTarget
  /** Approval-capable durable execution context for consequential computer actions. */
  computerApprovalContext?: 'work' | 'automation'
  workspaceId?: string
  baseUrl?: string
  allowedToolIds?: readonly string[]
  /** Original browser Cookie header — required for server-side tool `fetch` to `/api/v1/*` (middleware expects session cookie). */
  forwardCookie?: string
  /** When `false`, hides memory mutation tools and restricts knowledge search to files for this turn. */
  memoryEnabled?: boolean
  /**
   * Who owns memories written this turn. Defaults to `userId`. A workspace
   * agent turn sets this to the agent's memory owner id so the agent builds up
   * its own memory instead of writing into the memory of whoever summoned it.
   */
  memoryOwnerId?: string
  /**
   * Set when a workspace agent is driving the turn. Tools still authenticate as
   * `userId` (the delegate model — see internal/develop/tool-catalog.md),
   * so this exists to attribute the work, not to authorize it.
   */
  agentId?: string
  agentPrincipalId?: string
  /**
   * Set when the turn is in a room others can read (internal/plans/TOOL_SCOPING_PLAN.md, T4): searches return only what the
   * workspace shares, and the list tools are limited to the Workspace scope, so the person's private items are not
   * brought into the room by default.
   */
  sharedRoom?: boolean
  /** Stable key supplied by durable runners for side-effecting internal API calls. */
  idempotencyKey?: string
  artifactPublicationAuthority?: ArtifactPublicationAuthority
}
