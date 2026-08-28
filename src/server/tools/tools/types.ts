import 'server-only'

export type { ToolCategory } from '@overlay/tools-core'

/**
 * Unified overlay-native tools (Act agent). See build.ts for composition.
 *
 * Composio tools are merged in act/route.ts (full set for paid; filtered for free tier).
 */

export interface OverlayToolsOptions {
  userId: string
  accessToken?: string
  serverSecret?: string
  conversationId?: string
  turnId?: string
  automationId?: string
  workspaceId?: string
  projectId?: string
  baseUrl?: string
  allowedToolIds?: readonly string[]
  /** Original browser Cookie header — required for server-side tool `fetch` to `/api/v1/*` (middleware expects session cookie). */
  forwardCookie?: string
  /**
   * When `false`, omits paid-only tools (remote browser session, Daytona workspace sandbox). Default: include them.
   * Free tier should pass `false`.
   */
  includePaidOnlyOverlayTools?: boolean
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
   * `userId` (the delegate model — see docs/develop/bring-your-own-agents.md),
   * so this exists to attribute the work, not to authorize it.
   */
  agentId?: string
  agentPrincipalId?: string
  /** Knowledge base ids activated for the current turn. */
  activeKnowledgeBaseIds?: readonly string[]
  /** Stable key supplied by durable runners for side-effecting internal API calls. */
  idempotencyKey?: string
}
