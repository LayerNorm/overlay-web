'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useRef } from 'react'
import type { useRouter } from 'next/navigation'
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
} from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { announceArchived } from '@/shared/app/archive-toast'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import { workspaceAgentUsesByo } from '../lib/byo-agent-setup'
import { useStartAgentChat } from '../lib/agent-chat'
import {
  confirmComputerToolRemoval,
  isAgentRevisionConflict,
  type AgentEditSaveResult,
} from '../lib/agent-edit-save-result'
import { toast } from '@overlay/ui/primitives'
import { notifyActionError } from './notification-events'
import type { useAgentRuntime } from './use-agent-runtime'
import type { useByoConnection } from './use-byo-connection'
import type { EditableAgent, useAgentEditorForm } from './use-agent-editor-form'
import type { useAgentComputer } from './use-agent-computer'
import { useAgentDirectory } from './AgentDirectoryProvider'

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
  runtime,
  byo,
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
  runtime: ReturnType<typeof useAgentRuntime>
  byo: ReturnType<typeof useByoConnection>
  form: ReturnType<typeof useAgentEditorForm>
  computer: ReturnType<typeof useAgentComputer>
  onCreated?: (agent: WorkspaceAgentDirectoryItem) => void
  onArchived?: () => void
  onSaved?: () => void
  keepOpenOnSave?: boolean
}) {
  const buildWorkspaceHref = useWorkspaceHref()
  const nativeDirectory = useAgentDirectory()
  const startAgentChat = useStartAgentChat()
  const createRequestId = useRef<string | null>(null)
  const { agentType, cloudAgent } = runtime
  const { environmentId, adapterId, workingDirectory } = byo
  const {
    enabledToolGroups,
  } = form
  const { agentComputer, computerSize, setComputerProvisionError } = computer

  const persistNew = () => {

    if (!activeWorkspaceId || busy) return
    setBusy(true)
    void (async () => {
      try {
        const requestId = createRequestId.current ??= globalThis.crypto.randomUUID()
        let savedAgent: WorkspaceAgentDirectoryItem
        if (nativeDirectory.mode === 'native') {
          savedAgent = await nativeDirectory.create(buildInput(), requestId)
        } else if (nativeDirectory.mode === 'legacy') {
          savedAgent = (await overlayAppClient.agents.create(activeWorkspaceId, buildInput())).agent
        } else {
          throw new Error(nativeDirectory.error ?? 'Native agent directory is unavailable')
        }
        createRequestId.current = null
        if (agentType === 'byo') {
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: savedAgent.id,
            environmentId, adapterId, workingDirectory: workingDirectory.trim(),
          }).catch(async (bindingError) => {
            // Agent identity may already be durable even if its remote binding
            // fails. Land on the edit page so a retry never creates a duplicate.
            setAgent(savedAgent)
            if (presentation === 'page') {
              router.push(buildWorkspaceHref(activeWorkspaceId, `/app/agents/${encodeURIComponent(savedAgent.id)}?hello=1`, 'personal'))
            }
            throw bindingError
          })
        }
        if (agentType === 'overlay' && computersAvailable && enabledToolGroups.has('computer')) {
          setComputerProvisionError(null)
          await overlayAppClient.computers.provision(activeWorkspaceId, {
            ownerType: 'agent',
            ownerId: savedAgent.id,
            size: computerSize,
            name: `${savedAgent.name} computer`,
          }).catch(async (computerError) => {
            setComputerProvisionError(
              computerError instanceof Error ? computerError.message : 'Could not create the computer.',
              savedAgent.id,
            )
            // The agent is durable even if its computer fails to provision —
            // land on the edit page so a retry never creates a duplicate agent.
            setAgent(savedAgent)
            if (presentation === 'page') {
              router.push(buildWorkspaceHref(activeWorkspaceId, `/app/agents/${encodeURIComponent(savedAgent.id)}?hello=1`, 'personal'))
            }
            throw computerError
          })
        }
        dispatchAgentDirectoryChanged(activeWorkspaceId)
        toast.success('Agent created.')
        if (onCreated) onCreated(savedAgent)
        else router.push(buildWorkspaceHref(activeWorkspaceId, `/app/agents/${encodeURIComponent(savedAgent.id)}?hello=1`, 'personal'))
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
    if (form.conflict) return 'conflict'
    const confirmation = confirmComputerToolRemoval({
      shouldConfirm: Boolean(
        agentType === 'overlay' && agentComputer && !enabledToolGroups.has('computer'),
      ),
      confirm: () => window.confirm(
        `Delete ${agent.name}'s computer? Its disk state is destroyed permanently.`,
      ),
      revertToggle: () => form.toggleToolGroup('computer'),
    })
    if (confirmation === 'cancelled') return 'cancelled'
    const editVersion = form.version
    const expectedRevision = form.baseRevision ?? (
      'revision' in agent && typeof agent.revision === 'string' ? agent.revision : undefined
    )
    setBusy(true)
    try {
      const saved = await persistAgentEdit({
        workspaceId: activeWorkspaceId,
        agent,
        persistProfile: async () => {
          if (nativeDirectory.mode === 'native') {
            if (!expectedRevision) throw new Error('The agent profile revision is unavailable')
            return { agent: await nativeDirectory.update(agent.id, buildInput(), expectedRevision) }
          }
          if (nativeDirectory.mode === 'legacy') return overlayAppClient.agents.update(activeWorkspaceId, agent.id, buildInput())
          throw new Error(nativeDirectory.error ?? 'Native agent directory is unavailable')
        },
        onProfileSaved: (savedAgent) => {
          form.acceptSavedAgent(savedAgent, editVersion, expectedRevision)
          setAgent((current) => {
            const currentRevision = current && 'revision' in current && typeof current.revision === 'string'
              ? current.revision
              : undefined
            if (
              expectedRevision
              && currentRevision
              && currentRevision !== expectedRevision
              && currentRevision !== savedAgent.revision
            ) return current
            return savedAgent
          })
          dispatchAgentDirectoryChanged(activeWorkspaceId)
        },
        agentType,
        cloudAgent,
        environmentId,
        adapterId,
        workingDirectory,
        computersAvailable,
        enabledToolGroups,
        computer,
      })
      void saved
      if (!silent) toast.success('Agent saved.')
      if (onSaved) onSaved()
      if (presentation === 'panel' && !keepOpenOnSave) closeEditor()
      return 'saved'
    } catch (saveError) {
      if (isAgentRevisionConflict(saveError)) {
        if (!form.isBaseRevisionCurrent(expectedRevision) || !form.isVersionCurrent(editVersion)) return 'failed'
        form.setConflict(true)
        toast.error('This agent changed elsewhere. Your draft is preserved; reload before saving again.')
        return 'conflict'
      }
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
    form.discardChanges(agent)
    closeEditor()
  }

  const archiveAgent = async () => {
    if (!activeWorkspaceId || !agent || busy) return
    const prompt = cloudAgent
      ? `Archive ${agent.name}? Overlay access will be revoked and provider cleanup queued. Cleanup permanently deletes the machine and its files; export anything you need first. Its message history will remain.`
      : `Archive ${agent.name}? It will leave rooms and teams, but its message history will remain.`
    if (!window.confirm(prompt)) return
    setBusy(true)
    try {
      // Revoke the hosted environment before archiving so cleanup remains attributable to the agent.
      if (cloudAgent) await overlayAppClient.cloudAgents.remove(activeWorkspaceId, agent.id)
      if (nativeDirectory.mode === 'native') await nativeDirectory.archive(agent.id)
      else if (nativeDirectory.mode === 'legacy') await overlayAppClient.agents.archive(activeWorkspaceId, agent.id)
      else throw new Error(nativeDirectory.error ?? 'Native agent directory is unavailable')
      dispatchAgentDirectoryChanged(activeWorkspaceId)
      const workspaceId = activeWorkspaceId
      announceArchived({
        name: agent.name,
        // Hosted agents stay archived; restoring one does not restore its retired runtime.
        ...(cloudAgent ? {} : {
          undo: async () => {
            if (nativeDirectory.mode === 'native') await nativeDirectory.restore(agent.id)
            else if (nativeDirectory.mode === 'legacy') await overlayAppClient.agents.restore(workspaceId, agent.id)
            else throw new Error(nativeDirectory.error ?? 'Native agent directory is unavailable')
          },
          onUndone: () => dispatchAgentDirectoryChanged(workspaceId),
        }),
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
      nativeAgentId: agent.id,

      buildHref: buildWorkspaceHref,
      push: (href) => router.push(href),
      replace: (href) => router.replace(href),
    }).catch((chatError) => {
      toast.error(chatError instanceof Error ? chatError.message : 'Could not start an agent chat.')
    })
  }

  return { persistNew, saveEdit, cancelEdit, archiveAgent, sayHello }
}

async function persistAgentEdit({
  workspaceId,
  agent,
  persistProfile,
  onProfileSaved,
  agentType,
  cloudAgent,
  environmentId,
  adapterId,
  workingDirectory,
  computersAvailable,
  enabledToolGroups,
  computer,
}: {
  workspaceId: string
  agent: WorkspaceAgentDirectoryItem
  persistProfile(): Promise<{ agent: EditableAgent }>
  onProfileSaved(agent: EditableAgent): void
  agentType: ReturnType<typeof useAgentRuntime>['agentType']
  cloudAgent: ReturnType<typeof useAgentRuntime>['cloudAgent']
  environmentId: ReturnType<typeof useByoConnection>['environmentId']
  adapterId: ReturnType<typeof useByoConnection>['adapterId']
  workingDirectory: ReturnType<typeof useByoConnection>['workingDirectory']
  computersAvailable: boolean
  enabledToolGroups: Set<string>
  computer: ReturnType<typeof useAgentComputer>
}) {
  const saved = await persistProfile()
  onProfileSaved(saved.agent)
  await updateAgentBinding({
    workspaceId,
    agent,
    savedAgentId: saved.agent.id,
    agentType,
    cloudAgent,
    environmentId,
    adapterId,
    workingDirectory,
  })
  await syncAgentComputer({
    workspaceId,
    agentType,
    computersAvailable,
    enabledToolGroups,
    savedAgent: saved.agent,
    computer,
  })
  return saved
}

async function updateAgentBinding({
  workspaceId,
  agent,
  savedAgentId,
  agentType,
  cloudAgent,
  environmentId,
  adapterId,
  workingDirectory,
}: {
  workspaceId: string
  agent: WorkspaceAgentDirectoryItem
  savedAgentId: string
  agentType: ReturnType<typeof useAgentRuntime>['agentType']
  cloudAgent: ReturnType<typeof useAgentRuntime>['cloudAgent']
  environmentId: ReturnType<typeof useByoConnection>['environmentId']
  adapterId: ReturnType<typeof useByoConnection>['adapterId']
  workingDirectory: ReturnType<typeof useByoConnection>['workingDirectory']
}) {
  if (agentType === 'byo' && cloudAgent) return
  if (agentType === 'byo') {
    await overlayAppClient.agentEnvironments.upsertBinding(workspaceId, {
      agentId: savedAgentId,
      environmentId,
      adapterId,
      workingDirectory: workingDirectory.trim(),
    })
    return
  }
  if (workspaceAgentUsesByo(agent)) {
    await overlayAppClient.agentEnvironments.disableBindings(workspaceId, savedAgentId)
      .catch(() => undefined)
  }
}

async function syncAgentComputer({
  workspaceId,
  agentType,
  computersAvailable,
  enabledToolGroups,
  savedAgent,
  computer,
}: {
  workspaceId: string
  agentType: ReturnType<typeof useAgentRuntime>['agentType']
  computersAvailable: boolean
  enabledToolGroups: Set<string>
  savedAgent: WorkspaceAgentDirectoryItem
  computer: ReturnType<typeof useAgentComputer>
}) {
  if (agentType !== 'overlay' || !computersAvailable) return
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
