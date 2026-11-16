'use client'

import type { Dispatch, SetStateAction } from 'react'
import type { useRouter } from 'next/navigation'
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
} from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { enabledAgentToolGroupIds } from '@/shared/agents/tool-groups'
import { announceArchived } from '@/shared/app/archive-toast'
import { startAgentChat } from '../lib/agent-chat'
import {
  confirmComputerToolRemoval,
  type AgentEditSaveResult,
} from '../lib/agent-edit-save-result'
import { AVATAR_FALLBACK_COLOR } from '../lib/agent-editor-utils'
import { nativeAgentModelId } from '@/shared/agents/agent-model'
import { toast } from '@overlay/ui/primitives'
import { notifyActionError } from './notification-events'
import type { useAgentEditorForm } from './use-agent-editor-form'
import type { useAgentComputer } from './use-agent-computer'

export function useAgentEditorActions({

  presentation,
  activeWorkspaceId,
  router,
  busy,
  setBusy,
  agent,
  setAgent,
  directoryHref,
  closeEditor,
  buildInput,
  computersAvailable,
  form,
  computer,
  onCreated,
  onArchived,
  onSaved,
  keepOpenOnSave = false,
}: {

  presentation: 'page' | 'panel'
  activeWorkspaceId: string | null
  router: ReturnType<typeof useRouter>
  busy: boolean
  setBusy: Dispatch<SetStateAction<boolean>>
  agent: WorkspaceAgentDirectoryItem | null
  setAgent: Dispatch<SetStateAction<WorkspaceAgentDirectoryItem | null>>
  directoryHref: string
  closeEditor(): void
  buildInput(): WorkspaceAgentCreateInput
  computersAvailable: boolean
  form: ReturnType<typeof useAgentEditorForm>
  computer: ReturnType<typeof useAgentComputer>
  onCreated?: (agent: WorkspaceAgentDirectoryItem) => void
  onArchived?: () => void
  onSaved?: () => void
  keepOpenOnSave?: boolean
}) {
  const buildWorkspaceHref = useWorkspaceHref()
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
  } = form
  const { agentComputer, computerSize, setComputerProvisionError } = computer

  const persistNew = () => {

    if (!activeWorkspaceId || busy) return
    setBusy(true)
    void (async () => {
      try {
        const saved = await overlayAppClient.agents.create(activeWorkspaceId, buildInput())
        if (computersAvailable && enabledToolGroups.has('computer')) {
          setComputerProvisionError(null)
          await overlayAppClient.computers.provision(activeWorkspaceId, {
            ownerType: 'agent',
            ownerId: saved.agent.id,
            size: computerSize,
            name: `${saved.agent.name} computer`,
          }).catch(async (computerError) => {
            setComputerProvisionError(
              computerError instanceof Error ? computerError.message : 'Could not create the computer.',
              saved.agent.id,
            )
            // The agent is durable even if its computer fails to provision —
            // land on the edit page so a retry never creates a duplicate agent.
            setAgent(saved.agent)
            if (presentation === 'page') {
              router.push(buildWorkspaceHref(activeWorkspaceId, `/app/agents/${encodeURIComponent(saved.agent.id)}?hello=1`, 'personal'))
            }
            throw computerError
          })
        }
        toast.success('Agent created.')
        if (onCreated) onCreated(saved.agent)
        else router.push(buildWorkspaceHref(activeWorkspaceId, `/app/agents/${encodeURIComponent(saved.agent.id)}?hello=1`, 'personal'))
      } catch (saveError) {
        notifyActionError((message) => toast.error(message), saveError, 'Could not save agent.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const saveEdit = async ({
    silent = false,
    ignoreBusy = false,
  }: {
    silent?: boolean
    ignoreBusy?: boolean
  } = {}): Promise<AgentEditSaveResult> => {
    if (!activeWorkspaceId || !agent || (busy && !ignoreBusy)) return 'failed'
    const confirmation = confirmComputerToolRemoval({
      shouldConfirm: Boolean(agentComputer && !enabledToolGroups.has('computer')),
      confirm: () => window.confirm(
        `Delete ${agent.name}'s computer? Its disk state is destroyed permanently.`,
      ),
      revertToggle: () => form.toggleToolGroup('computer'),
    })
    if (confirmation === 'cancelled') return 'cancelled'
    const editVersion = form.version
    setBusy(true)
    try {
      const saved = await persistAgentEdit({
        workspaceId: activeWorkspaceId,
        agent,
        buildInput,
        computersAvailable,
        enabledToolGroups,
        computer,
      })
      if (form.isVersionCurrent(editVersion)) {
        setAgent(saved.agent)
        setDirty(false)
      }
      if (!silent) toast.success('Agent saved.')
      if (onSaved) onSaved()
      if (presentation === 'panel' && !keepOpenOnSave) closeEditor()
      return 'saved'
    } catch (saveError) {
      if (!silent) toast.error(saveError instanceof Error ? saveError.message : 'Could not save agent.')
      return 'failed'
    } finally {
      setBusy(false)
    }
  }

  const cancelEdit = () => {
    if (!agent) {
      closeEditor()
      return
    }
    setName(agent.name)
    setDescription(agent.description ?? '')
    setInstructions(agent.instructions)
    setModelId(nativeAgentModelId(agent.modelId))
    setAvatarColor(agent.avatarColor ?? AVATAR_FALLBACK_COLOR)
    setAvatarShape(agent.avatarShape ?? 'circle')
    setVisibility(agent.visibility)
    setEnabledToolGroups(enabledAgentToolGroupIds(agent.allowedToolIds))
    setDirty(false)
    closeEditor()
  }

  const archiveAgent = async () => {
    if (!activeWorkspaceId || !agent || busy) return
    if (!window.confirm(`Archive ${agent.name}? It will leave rooms and teams, but its message history will remain.`)) return
    setBusy(true)
    try {
      await overlayAppClient.agents.archive(activeWorkspaceId, agent.id)
      const workspaceId = activeWorkspaceId
      announceArchived({
        name: agent.name,
        undo: async () => { await overlayAppClient.agents.restore(workspaceId, agent.id) },
      })
      if (onArchived) onArchived()
      else router.push(directoryHref)
    } catch (archiveError) {
      toast.error(archiveError instanceof Error ? archiveError.message : 'Could not archive agent.')
    } finally {
      setBusy(false)
    }
  }

  const sayHello = () => {
    if (!agent) return
    void startAgentChat({
      workspaceId: activeWorkspaceId,
      agentPrincipalId: agent.principalId,

      buildHref: buildWorkspaceHref,
      push: (href) => router.push(href),
    }).catch((chatError) => {
      toast.error(chatError instanceof Error ? chatError.message : 'Could not start an agent chat.')
    })
  }

  return { persistNew, saveEdit, cancelEdit, archiveAgent, sayHello }
}

async function persistAgentEdit({
  workspaceId,
  agent,
  buildInput,
  computersAvailable,
  enabledToolGroups,
  computer,
}: {
  workspaceId: string
  agent: WorkspaceAgentDirectoryItem
  buildInput(): WorkspaceAgentCreateInput
  computersAvailable: boolean
  enabledToolGroups: Set<string>
  computer: ReturnType<typeof useAgentComputer>
}) {
  const saved = await overlayAppClient.agents.update(workspaceId, agent.id, buildInput())
  await syncAgentComputer({
    workspaceId,
    computersAvailable,
    enabledToolGroups,
    savedAgent: saved.agent,
    computer,
  })
  return saved
}

async function syncAgentComputer({
  workspaceId,
  computersAvailable,
  enabledToolGroups,
  savedAgent,
  computer,
}: {
  workspaceId: string
  computersAvailable: boolean
  enabledToolGroups: Set<string>
  savedAgent: WorkspaceAgentDirectoryItem
  computer: ReturnType<typeof useAgentComputer>
}) {
  if (!computersAvailable) return
  const { agentComputer, setAgentComputer, computerSize, setComputerProvisionError } = computer
  if (enabledToolGroups.has('computer') && (!agentComputer || agentComputer.status === 'error')) {
    setComputerProvisionError(null)
    const provisioned = await overlayAppClient.computers.provision(workspaceId, {
      ownerType: 'agent',
      ownerId: savedAgent.id,
      size: computerSize,
      name: `${savedAgent.name} computer`,
    }).catch((computerError: unknown) => {
      setComputerProvisionError(
        computerError instanceof Error ? computerError.message : 'Could not create the computer.',
        savedAgent.id,
      )
      throw computerError
    })
    setAgentComputer(provisioned.computer)
    setComputerProvisionError(null)
    return
  }
  if (!enabledToolGroups.has('computer') && agentComputer) {
    await overlayAppClient.computers.destroy(workspaceId, agentComputer.id)
    setAgentComputer(null)
  }
}
