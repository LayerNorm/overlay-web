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
}
