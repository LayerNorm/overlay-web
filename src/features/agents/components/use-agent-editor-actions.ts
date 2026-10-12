'use client'

import type { Dispatch, SetStateAction } from 'react'
import type { useRouter } from 'next/navigation'
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
} from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { enabledAgentToolGroupIds } from '@/shared/agents/tool-groups'
import { announceArchived } from '@/shared/app/archive-toast'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import { workspaceAgentUsesByo } from '../lib/byo-agent-setup'
import { buildAgentEditorHref, startAgentChat } from '../lib/agent-chat'
import { AVATAR_FALLBACK_COLOR } from '../lib/agent-editor-utils'
import type { useAgentRuntime } from './use-agent-runtime'
import type { useByoConnection } from './use-byo-connection'
import type { useAgentEditorForm } from './use-agent-editor-form'
import type { useAgentComputer } from './use-agent-computer'

export function useAgentEditorActions({
  showcase,
  presentation,
  activeWorkspaceId,
  router,
  busy,
  setBusy,
  setError,
  agent,
  setAgent,
  directoryHref,
  closeEditor,
  buildInput,
  computersAvailable,
  runtime,
  byo,
  form,
  computer,
  onCreated,
  onArchived,
  onSaved,
}: {
  showcase: boolean
  presentation: 'page' | 'panel'
  activeWorkspaceId: string | null
  router: ReturnType<typeof useRouter>
  busy: boolean
  setBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  agent: WorkspaceAgentDirectoryItem | null
  setAgent: Dispatch<SetStateAction<WorkspaceAgentDirectoryItem | null>>
  directoryHref: string
  closeEditor(): void
  buildInput(): WorkspaceAgentCreateInput
  computersAvailable: boolean
  runtime: ReturnType<typeof useAgentRuntime>
  byo: ReturnType<typeof useByoConnection>
  form: ReturnType<typeof useAgentEditorForm>
  computer: ReturnType<typeof useAgentComputer>
  onCreated?: (agent: WorkspaceAgentDirectoryItem) => void
  onArchived?: () => void
  onSaved?: () => void
}) {
  const { agentType, cloudAgent } = runtime
  const { environmentId, adapterId, workingDirectory } = byo
  const {
    enabledToolGroups,
    setEnabledToolGroups,
    setName,
    setDescription,
    setInstructions,
    setModelId,
    setAvatarColor,
    setAvatarShape,
    setVisibility,
    setDirty,
    setSavedFlash,
  } = form
  const { agentComputer, setAgentComputer, computerSize } = computer

  const persistNew = () => {
    if (showcase) {
      router.push(directoryHref)
      return
    }
    if (!activeWorkspaceId || busy) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const saved = await overlayAppClient.agents.create(activeWorkspaceId, buildInput())
        if (agentType === 'byo') {
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: saved.agent.id,
            environmentId, adapterId, workingDirectory: workingDirectory.trim(),
          }).catch(async (bindingError) => {
            // Agent identity may already be durable even if its remote binding
            // fails. Land on the edit page so a retry never creates a duplicate.
            setAgent(saved.agent)
            if (presentation === 'page') {
              router.push(`${buildAgentEditorHref(activeWorkspaceId, saved.agent.id)}?hello=1`)
            }
            throw bindingError
          })
        }
        if (agentType === 'overlay' && computersAvailable && enabledToolGroups.has('computer')) {
          await overlayAppClient.computers.provision(activeWorkspaceId, {
            ownerType: 'agent',
            ownerId: saved.agent.id,
            size: computerSize,
            name: `${saved.agent.name} computer`,
          }).catch(async (computerError) => {
            // The agent is durable even if its computer fails to provision —
            // land on the edit page so a retry never creates a duplicate agent.
            setAgent(saved.agent)
            if (presentation === 'page') {
              router.push(`${buildAgentEditorHref(activeWorkspaceId, saved.agent.id)}?hello=1`)
            }
            throw computerError
          })
        }
        dispatchAgentDirectoryChanged(activeWorkspaceId)
        if (onCreated) onCreated(saved.agent)
        else router.push(`${buildAgentEditorHref(activeWorkspaceId, saved.agent.id)}?hello=1`)
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save agent.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const saveEdit = () => {
    if (showcase || !activeWorkspaceId || !agent || busy) return
    if (
      agentType === 'overlay' && agentComputer && !enabledToolGroups.has('computer')
      && !window.confirm(`Delete ${agent.name}'s computer? Its disk state is destroyed permanently.`)
    ) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const saved = await overlayAppClient.agents.update(activeWorkspaceId, agent.id, buildInput())
        if (agentType === 'byo' && cloudAgent) {
          // An Overlay Cloud agent's binding (machine, account) is managed from its machine panel; rewriting it here would drop the account.
        } else if (agentType === 'byo') {
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: saved.agent.id,
            environmentId, adapterId, workingDirectory: workingDirectory.trim(),
          })
        } else if (workspaceAgentUsesByo(agent)) {
          // Switched a connected agent back to Overlay: drop its binding once.
          await overlayAppClient.agentEnvironments.disableBindings(activeWorkspaceId, saved.agent.id)
            .catch(() => undefined)
        }
        if (agentType === 'overlay' && computersAvailable) {
          // An `error`-status computer is a dead row from a failed provision —
          // saving retries the provision; the service reclaims the dead row.
          if (enabledToolGroups.has('computer') && (!agentComputer || agentComputer.status === 'error')) {
            const provisioned = await overlayAppClient.computers.provision(activeWorkspaceId, {
              ownerType: 'agent',
              ownerId: saved.agent.id,
              size: computerSize,
              name: `${saved.agent.name} computer`,
            })
            setAgentComputer(provisioned.computer)
          } else if (!enabledToolGroups.has('computer') && agentComputer) {
            await overlayAppClient.computers.destroy(activeWorkspaceId, agentComputer.id)
            setAgentComputer(null)
          }
        }
        dispatchAgentDirectoryChanged(activeWorkspaceId)
        setAgent(saved.agent)
        setDirty(false)
        setSavedFlash(true)
        if (onSaved) onSaved()
        // Panel presentations close on save — the saved flash only matters on
        // the standalone editor page. onSaved must run first: it clears the
        // workspace's never-saved marker before closeEditor can act on it.
        if (presentation === 'panel') closeEditor()
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save agent.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const cancelEdit = () => {
    if (!agent) {
      closeEditor()
      return
    }
    setName(agent.name)
    setDescription(agent.description ?? '')
    setInstructions(agent.instructions)
    setModelId(agent.modelId)
    setAvatarColor(agent.avatarColor ?? AVATAR_FALLBACK_COLOR)
    setAvatarShape(agent.avatarShape ?? 'circle')
    setVisibility(agent.visibility)
    setEnabledToolGroups(enabledAgentToolGroupIds(agent.allowedToolIds))
    setDirty(false)
    setError(null)
    closeEditor()
  }

  const archiveAgent = async () => {
    if (showcase || !activeWorkspaceId || !agent || busy) return
    const prompt = cloudAgent
      ? `Archive ${agent.name}? Its machine and everything on it is deleted. Its message history will remain.`
      : `Archive ${agent.name}? It will leave rooms and teams, but its message history will remain.`
    if (!window.confirm(prompt)) return
    setBusy(true)
    setError(null)
    try {
      // Delete the machine first so a failure leaves the agent in place to retry, not a paid machine with no owner.
      if (cloudAgent) await overlayAppClient.cloudAgents.remove(activeWorkspaceId, agent.id)
      await overlayAppClient.agents.archive(activeWorkspaceId, agent.id)
      dispatchAgentDirectoryChanged(activeWorkspaceId)
      const workspaceId = activeWorkspaceId
      announceArchived({
        name: agent.name,
        // An agent's machine is deleted when it is archived, so restoring a cloud agent does not bring that back.
        ...(cloudAgent ? {} : {
          undo: async () => { await overlayAppClient.agents.restore(workspaceId, agent.id) },
          onUndone: () => dispatchAgentDirectoryChanged(workspaceId),
        }),
      })
      if (onArchived) onArchived()
      else router.push(directoryHref)
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Could not archive agent.')
    } finally {
      setBusy(false)
    }
  }

  const sayHello = () => {
    if (!agent) return
    void startAgentChat({
      workspaceId: activeWorkspaceId,
      agentPrincipalId: agent.principalId,
      showcase,
      push: (href) => router.push(href),
    }).catch((chatError) => {
      setError(chatError instanceof Error ? chatError.message : 'Could not start an agent chat.')
    })
  }

  return { persistNew, saveEdit, cancelEdit, archiveAgent, sayHello }
}
