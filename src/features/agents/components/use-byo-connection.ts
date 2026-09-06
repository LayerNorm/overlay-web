'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentEnvironmentResource } from '@overlay/api-client'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import {
  availableByoHarnesses,
  defaultWorkingDirectory,
  environmentSupportsHarness,
  type BuiltInByoHarnessId,
} from '../lib/byo-agent-setup'
import { parseRoots, type AgentType, type EnvironmentChoice } from './AgentEditorForm'

/**
 * The Bring-your-own-agent connection state machine: harness choice,
 * environment selection, new-machine enrollment (command + polling +
 * approval). Extracted from the editor page so the page stays under the
 * complexity and file-size budgets; behavior is unchanged.
 */
export function useByoConnection(args: {
  activeWorkspaceId: string | null
  showcase: boolean
  agent: WorkspaceAgentDirectoryItem | null
  agentType: AgentType
  connectedAgentsEnabled: boolean
  setAgentType(value: AgentType): void
}) {
  const { activeWorkspaceId, showcase, agent, agentType, connectedAgentsEnabled, setAgentType } = args
  const [environmentChoice, setEnvironmentChoice] = useState<EnvironmentChoice>('existing')
  const [environments, setEnvironments] = useState<AgentEnvironmentResource[]>([])
  const [environmentsLoading, setEnvironmentsLoading] = useState(false)
  const [environmentId, setEnvironmentId] = useState('')
  const [adapterId, setAdapterId] = useState('codex')
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [environmentBusy, setEnvironmentBusy] = useState<string | null>(null)
  const [environmentError, setEnvironmentError] = useState<string | null>(null)
  const [command, setCommand] = useState('')
  const [copied, setCopied] = useState(false)
  const [setupEnvironmentId, setSetupEnvironmentId] = useState<string | null>(null)
  const [setupRoots, setSetupRoots] = useState('')
  const [enrollmentBaselineIds, setEnrollmentBaselineIds] = useState<string[]>([])

  const refreshEnvironments = useCallback(async () => {
    if (!activeWorkspaceId || showcase) return []
    const result = await overlayAppClient.agentEnvironments.list(activeWorkspaceId, { cache: 'no-store' })
    setEnvironments(result.environments)
    return result.environments
  }, [activeWorkspaceId, showcase])

  useEffect(() => {
    if (!activeWorkspaceId || showcase || !connectedAgentsEnabled || (!agent && agentType !== 'byo')) return
    let cancelled = false
    setEnvironmentsLoading(true)
    setEnvironmentError(null)
    void Promise.all([
      overlayAppClient.agentEnvironments.list(activeWorkspaceId, { cache: 'no-store' }),
      agent ? overlayAppClient.agentEnvironments.listBindings(activeWorkspaceId, agent.id) : Promise.resolve({ bindings: [] }),
    ]).then(([environmentResult, bindingResult]) => {
      if (cancelled) return
      setEnvironments(environmentResult.environments)
      const binding = bindingResult.bindings[0]
      if (!binding) return
      const bindingAdapterId = typeof binding.adapterConfig.adapterId === 'string'
        ? binding.adapterConfig.adapterId : 'codex'
      setAgentType('byo')
      setEnvironmentChoice('existing')
      setEnvironmentId(binding.environmentId)
      setAdapterId(bindingAdapterId)
      setWorkingDirectory(typeof binding.adapterConfig.workingDirectory === 'string'
        ? binding.adapterConfig.workingDirectory : '')
    }).catch((value) => {
      if (!cancelled) setEnvironmentError(value instanceof Error ? value.message : 'Could not load environments.')
    }).finally(() => {
      if (!cancelled) setEnvironmentsLoading(false)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, agent, agentType, connectedAgentsEnabled, setAgentType, showcase])

  useEffect(() => {
    if (!command || setupEnvironmentId) return
    const timer = window.setInterval(() => {
      void refreshEnvironments().catch((value) => {
        setEnvironmentError(value instanceof Error ? value.message : 'Could not refresh environments.')
      })
    }, 2_500)
    return () => window.clearInterval(timer)
  }, [command, refreshEnvironments, setupEnvironmentId])

  useEffect(() => {
    if (!command || setupEnvironmentId) return
    const baseline = new Set(enrollmentBaselineIds)
    const pending = [...environments]
      .filter((environment) => environment.status === 'pending' && !baseline.has(environment.id))
      .sort((left, right) => right.createdAt - left.createdAt)[0]
    if (pending) setSetupEnvironmentId(pending.id)
  }, [command, enrollmentBaselineIds, environments, setupEnvironmentId])

  const harnessOptions = useMemo(() => availableByoHarnesses(environments), [environments])
  const selectedHarness = harnessOptions.find((harness) => harness.id === adapterId) ?? harnessOptions[0]!
  const compatibleEnvironments = useMemo(() => environments.filter((environment) => (
    environment.status !== 'pending'
      && environment.status !== 'revoked'
      && environmentSupportsHarness(environment, adapterId)
  )), [adapterId, environments])
  const selectedEnvironment = environments.find((environment) => environment.id === environmentId)
  const setupEnvironment = environments.find((environment) => environment.id === setupEnvironmentId)
  const bindingValid = Boolean(environmentId && adapterId && workingDirectory.trim())

  const chooseHarness = (nextAdapterId: string) => {
    setAdapterId(nextAdapterId)
    setEnvironmentError(null)
    setCommand('')
    setSetupEnvironmentId(null)
    setSetupRoots('')
    if (selectedEnvironment && !environmentSupportsHarness(selectedEnvironment, nextAdapterId)) {
      setEnvironmentId('')
      setWorkingDirectory('')
    }
    const nextHarness = harnessOptions.find((harness) => harness.id === nextAdapterId)
    if (nextHarness && !nextHarness.connectable && environmentChoice !== 'existing') {
      setEnvironmentChoice('existing')
    }
  }

  const chooseEnvironment = (nextEnvironmentId: string) => {
    const environment = environments.find((candidate) => candidate.id === nextEnvironmentId)
    setEnvironmentId(nextEnvironmentId)
    setWorkingDirectory(defaultWorkingDirectory(environment))
  }

  const beginConnection = async () => {
    if (showcase) {
      setEnvironmentError('Sign in to connect an environment.')
      return
    }
    if (!activeWorkspaceId || !selectedHarness?.connectable) return
    setEnvironmentBusy('connect')
    setEnvironmentError(null)
    setCommand('')
    setSetupEnvironmentId(null)
    setSetupRoots('')
    setEnrollmentBaselineIds(environments.map((environment) => environment.id))
    try {
      const result = await overlayAppClient.agentEnvironments.createEnrollment(activeWorkspaceId, {
        adapterId: adapterId as BuiltInByoHarnessId,
      })
      setCommand(result.command)
    } catch (value) {
      setEnvironmentError(value instanceof Error ? value.message : 'Could not create the connection command.')
    } finally {
      setEnvironmentBusy(null)
    }
  }

  const approveSetupEnvironment = async () => {
    if (!activeWorkspaceId || !setupEnvironmentId) return
    const roots = parseRoots(setupRoots)
    if (roots.length === 0) {
      setEnvironmentError('Enter at least one absolute project root.')
      return
    }
    setEnvironmentBusy('approve')
    setEnvironmentError(null)
    try {
      await overlayAppClient.agentEnvironments.approve(activeWorkspaceId, setupEnvironmentId, {
        mode: 'selected_roots', roots,
      })
      await refreshEnvironments()
      setEnvironmentId(setupEnvironmentId)
      setWorkingDirectory(roots[0]!)
      setEnvironmentChoice('existing')
      setCommand('')
      setSetupEnvironmentId(null)
      setSetupRoots('')
    } catch (value) {
      setEnvironmentError(value instanceof Error ? value.message : 'Environment approval failed.')
    } finally {
      setEnvironmentBusy(null)
    }
  }

  const copyCommand = async () => {
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    } catch {
      setEnvironmentError('Could not copy the command. Select it and copy it manually.')
    }
  }

  return {
    environmentChoice,
    setEnvironmentChoice,
    environmentsLoading,
    environmentId,
    adapterId,
    workingDirectory,
    setWorkingDirectory,
    harnessOptions,
    selectedHarness,
    compatibleEnvironments,
    setupEnvironment,
    environmentBusy,
    environmentError,
    command,
    copied,
    setupRoots,
    setSetupRoots,
    bindingValid,
    chooseHarness,
    chooseEnvironment,
    beginConnection,
    approveSetupEnvironment,
    copyCommand,
  }
}

export type ByoConnection = ReturnType<typeof useByoConnection>
