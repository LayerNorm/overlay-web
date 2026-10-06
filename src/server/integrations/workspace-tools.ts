import 'server-only'

import type { ToolSet } from 'ai'
import { WORKSPACE_TOOL_PREFIX } from '@/shared/integrations/workspace-connector-entity'

/**
 * A workspace's connector accounts are a second tool-router session beside the person's own, with the same tool names.
 * Prefixing keeps both in one tool set; the description says whose accounts a tool acts through so the model can choose.
 */
export function prefixWorkspaceTools(tools: ToolSet): ToolSet {
  const prefixed: ToolSet = {}
  for (const [name, definition] of Object.entries(tools)) {
    const description = (definition as { description?: string }).description
    prefixed[`${WORKSPACE_TOOL_PREFIX}${name}`] = {
      ...definition,
      description: `Acts through the workspace's shared connector accounts (not your own). ${description ?? ''}`.trim(),
    } as ToolSet[string]
  }
  return prefixed
}

/** Gives tools the workspace name prefix without touching their descriptions (they already say whose accounts they use). */
export function withWorkspaceNamePrefix(tools: ToolSet): ToolSet {
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => [`${WORKSPACE_TOOL_PREFIX}${name}`, definition]))
}

/** Splits a merged tool set back into the person's tools and the workspace's (names without the prefix). */
export function splitWorkspaceTools(tools: ToolSet): { own: ToolSet; workspace: ToolSet } {
  const own: ToolSet = {}
  const workspace: ToolSet = {}
  for (const [name, definition] of Object.entries(tools)) {
    if (name.startsWith(WORKSPACE_TOOL_PREFIX)) workspace[name.slice(WORKSPACE_TOOL_PREFIX.length)] = definition
    else own[name] = definition
  }
  return { own, workspace }
}
