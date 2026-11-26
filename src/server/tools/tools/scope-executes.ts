import 'server-only'

import { callInternalApi, toolAuthBody } from './internal-api'
import type { OverlayToolsOptions } from './types'

/**
 * Agent tools for what the Move to Workspace, Archive and Restore buttons do (`POST /api/v1/scope`), under the person's
 * own rules: only the creator moves an item, moves are one-way, and archive/restore need edit rights. In a workspace
 * context (a room others can read, a workspace automation) nothing moves, and only Workspace items archive or restore.
 */

export const SCOPE_TOOL_RESOURCES = ['file', 'skill', 'automation', 'task'] as const
export type ScopeToolResource = (typeof SCOPE_TOOL_RESOURCES)[number]

/** The scope API's name for each kind. Notes, folders and generated outputs are all files. */
const API_RESOURCE: Record<ScopeToolResource, string> = {
  file: 'files',
  skill: 'skills',
  automation: 'automations',
  task: 'work',
}

/** An agent may move or archive a kind of item only if it may already change that kind. */
const GRANTING_TOOLS: Record<ScopeToolResource, readonly string[]> = {
  file: ['write_file', 'create_note', 'update_note'],
  skill: ['save_skill'],
  automation: ['update_automation'],
  task: ['update_task'],
}

export const ROOM_MOVE_ERROR =
  'Moving to Workspace shares a Personal item, so it is done by its owner outside a room others can read (in a personal chat, or with the Move to Workspace button), not here.'

function grantRefusal(options: OverlayToolsOptions, resource: ScopeToolResource): string | null {
  const allowed = options.allowedToolIds
  if (!allowed) return null
  return GRANTING_TOOLS[resource].some((id) => allowed.includes(id))
    ? null
    : `This agent can't change ${resource === 'task' ? 'tasks' : `${resource}s`}, so it can't move or archive them.`
}

async function changeScope(
  options: OverlayToolsOptions,
  input: { resource: ScopeToolResource; id: string },
  action: 'move' | 'archive' | 'restore',
  extra: Record<string, unknown> = {},
) {
  const id = input.id?.trim()
  if (!id) return { success: false, error: 'id is required.' }
  const refused = grantRefusal(options, input.resource)
  if (refused) return { success: false, error: refused }
  if (action === 'move' && options.sharedRoom) return { success: false, error: ROOM_MOVE_ERROR }
  try {
    const res = await callInternalApi(
      '/api/v1/scope',
      {
        ...toolAuthBody(options),
        ...(options.agentPrincipalId ? { actingAgentPrincipalId: options.agentPrincipalId } : {}),
        ...(options.sharedRoom ? { workspaceItemsOnly: true } : {}),
        resource: API_RESOURCE[input.resource],
        id,
        action,
        ...extra,
      },
      options.accessToken,
      options.baseUrl,
      { forwardCookie: options.forwardCookie },
    )
    if (!res.ok) {
      const body = await res.json().catch((_error) => null) as { error?: string } | null
      return { success: false, error: body?.error ?? `Could not ${action} it.` }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : `Could not ${action} it.` }
  }
}

export async function executeMoveToWorkspace(
  options: OverlayToolsOptions,
  input: { resource: ScopeToolResource; id: string; withAgent?: boolean },
) {
  const result = await changeScope(options, input, 'move', {
    to: 'workspace',
    ...(input.resource === 'automation' && input.withAgent === true ? { withAgent: true } : {}),
  })
  return result.success ? { ...result, scope: 'workspace' as const } : result
}

export async function executeArchiveItem(options: OverlayToolsOptions, input: { resource: ScopeToolResource; id: string }) {
  const result = await changeScope(options, input, 'archive')
  return result.success ? { ...result, archived: true } : result
}

export async function executeRestoreItem(options: OverlayToolsOptions, input: { resource: ScopeToolResource; id: string }) {
  const result = await changeScope(options, input, 'restore')
  return result.success ? { ...result, archived: false } : result
}
