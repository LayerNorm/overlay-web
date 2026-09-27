'use client'

import type { Dispatch, SetStateAction } from 'react'
import type { useRouter } from 'next/navigation'
import type {
  ManagedHarnessId,
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
} from '@overlay/workspace-contracts'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { enabledAgentToolGroupIds } from '@/shared/agents/tool-groups'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import { workspaceAgentUsesByo } from '../lib/byo-agent-setup'
import { buildAgentEditorHref, startAgentChat } from '../lib/agent-chat'
import { AVATAR_COLORS } from '../lib/agent-editor-utils'
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
  const {
    agentType,
    hostedRuntime,
    harnessModel,
    managedHarnessEntry,
    harnessModelOption,
    managedEnvironment,
    managedWorkingDirectory,
    managedRuntimeSelected,
    boundHarnessId,
    boundHarnessModel,
    boundModelAccess,
    modelAccess,
    setManagedEnvironment,
    setBoundHarnessId,
    setBoundHarnessModel,
    setBoundModelAccess,
    setModelAccess,
    setHostedRuntime,
    setHarnessModel,
  } = runtime
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
        if (managedRuntimeSelected && managedHarnessEntry && !managedHarnessEntry.legacy) {
          // Durable identity first, then the managed sandbox, then the binding —
          // a failure after create lands on the edit page so retry never
          // duplicates the agent.
          await (async () => {
            const provisioned = await overlayAppClient.agentEnvironments.createManaged(activeWorkspaceId, {
              mode: 'harness',
              harnessId: managedHarnessEntry.id,
            })
            await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
              agentId: saved.agent.id,
              environmentId: provisioned.environment.id,
              adapterId: managedHarnessEntry.id,
              workingDirectory: managedWorkingDirectory,
              ...(harnessModelOption?.value ? { model: harnessModelOption.value } : {}),
              ...(modelAccess !== 'overlay'
                ? { modelBilling: 'byok' as const, byokConnectionId: modelAccess }
                : { modelBilling: 'overlay' as const }),
            })
          })().catch(async (bindingError) => {
            setAgent(saved.agent)
            if (presentation === 'page') {
              router.push(`${buildAgentEditorHref(activeWorkspaceId, saved.agent.id)}?hello=1`)
            }
            throw bindingError
          })
        } else if (agentType === 'byo') {
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
        // A managed-harness env already is a machine — computer tools resolve
        // it through the env fallback, so provisioning a second box is waste.
        if (agentType === 'overlay' && !managedRuntimeSelected && computersAvailable && enabledToolGroups.has('computer')) {
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

  // Rebinds the agent to its managed harness environment on save. Returns the
  // environment now bound (null when the managed path isn't active). Pulled out
  // of saveEdit: the grandfathered-runtime logic is self-contained.
  const saveManagedHarnessBinding = async (savedAgentId: string): Promise<AgentEnvironmentResource | null> => {
    // Grandfathered binding: the picker is gated off (or unreachable for this
    // surface) but the loaded binding still points at a managed harness —
    // rebind on the existing environment so saving never drops it.
    const grandfatheredHarness = !managedHarnessEntry
      && boundHarnessId === hostedRuntime && Boolean(managedEnvironment)
    if (!managedHarnessEntry && !grandfatheredHarness) return null
    const harnessId = managedHarnessEntry?.id ?? (hostedRuntime as ManagedHarnessId)
    // Same harness → rebind on the existing environment; a runtime switch needs
    // a fresh sandbox since each environment advertises one harness.
    const environment = (grandfatheredHarness || (managedEnvironment && boundHarnessId === hostedRuntime))
      ? managedEnvironment
      : (await overlayAppClient.agentEnvironments.createManaged(activeWorkspaceId!, {
          mode: 'harness',
          harnessId,
        })).environment
    if (!environment) throw new Error('This agent’s managed environment is unavailable.')
    await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId!, {
      agentId: savedAgentId,
      environmentId: environment.id,
      adapterId: harnessId,
      workingDirectory: managedWorkingDirectory,
      // Without a picker entry (flag off) the catalog can't resolve the option —
      // fall back to the loaded binding value so re-saving never silently drops
      // the configured model.
      ...((harnessModelOption?.value ?? harnessModel) ? { model: harnessModelOption?.value ?? harnessModel } : {}),
      ...(modelAccess !== 'overlay'
        ? { modelBilling: 'byok' as const, byokConnectionId: modelAccess }
        : { modelBilling: 'overlay' as const }),
    })
    setManagedEnvironment(environment)
    setBoundHarnessId(harnessId)
    setBoundHarnessModel(harnessModelOption?.value ?? harnessModel ?? '')
    setBoundModelAccess(modelAccess)
    return environment
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
        // null unless the managed branch rebinds — any other path means the
        // loaded managed environment (if any) is being retired.
        let nextManagedEnvironment: AgentEnvironmentResource | null = null
        if (managedRuntimeSelected
          && (managedHarnessEntry || (boundHarnessId === hostedRuntime && managedEnvironment))) {
          nextManagedEnvironment = await saveManagedHarnessBinding(saved.agent.id)
        } else if (agentType === 'byo') {
          await overlayAppClient.agentEnvironments.upsertBinding(activeWorkspaceId, {
            agentId: saved.agent.id,
            environmentId, adapterId, workingDirectory: workingDirectory.trim(),
          })
        } else if (workspaceAgentUsesByo(agent) || managedEnvironment) {
          // Switched a connected agent back to Overlay: drop its binding once.
          await overlayAppClient.agentEnvironments.disableBindings(activeWorkspaceId, saved.agent.id)
            .catch(() => undefined)
          nextManagedEnvironment = null
          setManagedEnvironment(null)
          setBoundHarnessId(null)
          setBoundHarnessModel('')
          setBoundModelAccess('overlay')
          setModelAccess('overlay')
        }
        // An environment this agent no longer uses keeps no sandbox: clearing
        // sessions + deleting the instance now beats waiting out the idle timeout.
        if (managedEnvironment && managedEnvironment.id !== nextManagedEnvironment?.id) {
          await overlayAppClient.agentEnvironments.resetHarness(activeWorkspaceId, managedEnvironment.id)
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
    setAvatarColor(agent.avatarColor ?? AVATAR_COLORS[0]!)
    setAvatarShape(agent.avatarShape ?? 'circle')
    setVisibility(agent.visibility)
    setEnabledToolGroups(enabledAgentToolGroupIds(agent.allowedToolIds))
    setHostedRuntime(boundHarnessId ?? 'overlay')
    setHarnessModel(boundHarnessModel)
    setModelAccess(boundModelAccess)
    setDirty(false)
    setError(null)
    closeEditor()
  }

  const archiveAgent = async () => {
    if (showcase || !activeWorkspaceId || !agent || busy) return
    if (!window.confirm(`Archive ${agent.name}? It will leave rooms and teams, but its message history will remain.`)) return
    setBusy(true)
    setError(null)
    try {
      await overlayAppClient.agents.archive(activeWorkspaceId, agent.id)
      dispatchAgentDirectoryChanged(activeWorkspaceId)
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
