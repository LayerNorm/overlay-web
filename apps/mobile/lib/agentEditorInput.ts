/**
 * Agent create/update payloads built from editor state. Mobile-local mirror of
 * the input-building pieces of web `src/features/agents/lib/agent-editor-input.ts`.
 * Every agent runs on Overlay's own harness.
 */
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentCreatureShape,
  WorkspaceAgentUpdateInput,
  WorkspaceAgentVisibility,
} from '@overlay/workspace-contracts'
import { toolIdsForEnabledGroups } from './agentToolGroups'

/** The built-in master agent skips deletion and keeps its fixed identity. */
export function isDefaultMasterAgent(
  agent: { isDefault?: boolean; name: string } | null | undefined,
): boolean {
  return Boolean(agent?.isDefault)
}

export function buildWorkspaceAgentInput(args: {
  name: string
  description: string
  instructions: string
  modelId: string
  avatarColor: string
  avatarShape: WorkspaceAgentCreatureShape
  enabledToolGroups: ReadonlySet<string>
  visibility: WorkspaceAgentVisibility
}): WorkspaceAgentCreateInput {
  return {
    name: args.name.trim(),
    description: args.description.trim() || undefined,
    instructions: args.instructions.trim(),
    harness: 'overlay',
    modelId: args.modelId.trim(),
    avatarColor: args.avatarColor,
    avatarShape: args.avatarShape,
    allowedToolIds: toolIdsForEnabledGroups(args.enabledToolGroups),
    visibility: args.visibility,
  }
}

export function buildWorkspaceAgentUpdateInput(
  input: WorkspaceAgentCreateInput,
  initialAvatarColor: string,
): WorkspaceAgentUpdateInput {
  const patch: WorkspaceAgentUpdateInput = { ...input }
  if (patch.avatarColor === initialAvatarColor) delete patch.avatarColor
  return patch
}

export function isAgentEditorValid(args: { name: string; instructions: string; modelId: string }): boolean {
  return Boolean(args.name.trim() && args.instructions.trim() && args.modelId.trim())
}

/** Plain messages for the agent save errors the server returns as codes. */
export function agentSaveErrorMessage(reason: unknown, fallback: string): string {
  const field = (key: 'message' | 'code') =>
    reason && typeof reason === 'object' && key in reason ? String((reason as Record<string, unknown>)[key] ?? '') : ''
  const message = field('message')
  const code = field('code')
  const has = (value: string) => message.includes(value) || code === value
  if (has('WORKSPACE_AGENT_VISIBILITY_ONE_WAY'))
    return 'A workspace agent can’t move back to Personal.'
  if (has('WORKSPACE_PERSONAL_MODEL'))
    return 'This agent is set to a personal provider, which workspace agents can’t use. Pick an Overlay model, then save again.'
  return message || fallback
}
