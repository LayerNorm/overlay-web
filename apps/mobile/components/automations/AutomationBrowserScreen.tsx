import React, { useRef, useState } from 'react'
import { createIdempotencyKey } from '@overlay/api-client'
import { Stack, useLocalSearchParams } from 'expo-router'
import type { AutomationRunSummary } from '@overlay/app-core'
import { api, type Id } from '../../services/convexClient'
import { useLiveResource } from '../../hooks/useLiveResource'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useAuth } from '../../contexts/AuthContext'
import { getRequestWorkspaceId } from '../../services/appApi'
import {
  deleteAutomation,
  runAutomationNow,
  setAutomationEnabled,
} from '../../services/automationsService'
import { useResourceScope } from '../knowledge/ResourceScreens'
import {
  AutomationDetail,
  AutomationList,
  ResourcePage,
  ResourceState,
  RUN_TERMINAL,
} from '../knowledge/ResourceViews'
import { FeatureGate } from '../ui/FeatureGate'
import { RoomConfirmDialog, type RoomConfirmation } from '../chat/RoomSheets'
import { AutomationRunSheet } from './AutomationRunSheet'
import { formatSchedule } from '../../lib/automationSchedule'
import { useMode } from '../../contexts/ModeContext'
import { moveToWorkspace } from '../../services/scopeService'
import { moveToWorkspaceConfirmation } from '../../lib/moveToWorkspace'

export function AutomationBrowserScreen() {
  const { workspaceId, theme, openDrawer, top, router } = useResourceScope()
  const { isFeatureEnabled } = useAppSession()
  const { session } = useAuth()
  const { id: routeId } = useLocalSearchParams<{ id?: string }>()
  const [selection, setSelection] = useState<{ scope: string | null; id: string | null } | null>(
    null,
  )
  const id = selection ? (selection.scope === workspaceId ? selection.id : null) : routeId || null
  const enabled = isFeatureEnabled('automations')
  // Automations follow the app's Workspace | Personal mode.
  const { mode } = useMode()
  const scope = enabled ? workspaceId : null
  const items = useLiveResource(
    api.automations.browse.list,
    scope ? { workspaceId: scope, includeAgentBound: true, view: mode } : null,
  )
  const detail = useLiveResource(
    api.automations.browse.get,
    scope && id ? { workspaceId: scope, automationId: id as Id<'automations'> } : null,
  )
  const runs = useLiveResource(
    api.automations.browse.runs,
    scope && id ? { workspaceId: scope, automationId: id as Id<'automations'> } : null,
  )
  const active = runs.data?.find((run) => !RUN_TERMINAL.has(run.status))
  const steps = useLiveResource(
    api.automations.workflowEvents.watchWorkflowStepEvents,
    scope && active?.workflowRunId && session
      ? {
          workflowRunId: active.workflowRunId,
          userId: session.user.id,
          accessToken: session.accessToken,
        }
      : null,
    scope,
  )
  const [confirmation, setConfirmation] = useState<RoomConfirmation | null>(null)
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [tokens, setTokens] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const runRequest = useRef<{ workspaceId: string; id: string; key: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = runs.data?.find((run) => run._id === selectedRun) ?? null
  async function action(operation: () => Promise<unknown>) {
    if (!workspaceId || getRequestWorkspaceId() !== workspaceId || busy) return
    const captured = workspaceId
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      if (getRequestWorkspaceId() === captured)
        setError(cause instanceof Error ? cause.message : 'Could not update this automation.')
    } finally {
      setBusy(false)
    }
  }
  if (!enabled) return <FeatureGate title="Automations are turned off" />
  return (
    <>
      <ResourcePage
        theme={theme}
        title="Automations"
        onBack={
          id
            ? () => {
                setSelection({ scope: workspaceId, id: null })
                setError(null)
              }
            : undefined
        }
      >
        {id ? (
          detail.data ? (
            <>
              <AutomationDetail
                theme={theme}
                item={detail.data}
                runs={runs.data ?? []}
                step={steps.data?.at(-1)?.stepName}
                schedule={formatSchedule(detail.data.schedule)}
                busy={busy}
                onRun={() => {
                  void action(async () => {
                    if (runRequest.current?.workspaceId !== workspaceId || runRequest.current.id !== id)
                      runRequest.current = { workspaceId: workspaceId!, id, key: createIdempotencyKey() }
                    const key = runRequest.current.key
                    const result = await runAutomationNow(id, key)
                    if (result.ok === false || result.error)
                      throw new Error(result.error || result.message || 'Could not start run.')
                    if (runRequest.current?.key === key) runRequest.current = null
                    if (
                      getRequestWorkspaceId() === workspaceId &&
                      result.runId &&
                      result.approvalToken
                    )
                      setTokens((current) => ({
                        ...current,
                        [result.runId!]: result.approvalToken!,
                      }))
                  })
                }}
                onToggle={() => {
                  void action(() => setAutomationEnabled(id, detail.data?.enabled === false))
                }}
                onEdit={() => router.push({ pathname: '/automation-edit', params: { id } })}
                onOpenRun={(run) => setSelectedRun(run._id)}
              />
              {runs.error || steps.error ? (
                <ResourceState
                  theme={theme}
                  error={runs.error || steps.error}
                  onRetry={() => {
                    runs.retry()
                    steps.retry()
                  }}
                />
              ) : null}
            </>
          ) : (
            <ResourceState
              theme={theme}
              loading={detail.loading || !scope}
              error={
                detail.error ||
                (detail.data === null ? 'This automation is no longer available.' : undefined)
              }
              onRetry={detail.retry}
            />
          )
        ) : items.data ? (
          <AutomationList
            theme={theme}
            items={items.data}
            onOpen={(item) => {
              setSelection({ scope: workspaceId, id: item._id })
              setError(null)
            }}
            onNew={() => router.push('/automation-edit')}
          />
        ) : (
          <ResourceState
            theme={theme}
            loading={items.loading || !scope}
            error={
              items.error ||
              (items.data === null ? 'Automations are unavailable in this workspace.' : undefined)
            }
            onRetry={items.retry}
          />
        )}
        {error ? <ResourceState theme={theme} error={error} /> : null}
      </ResourcePage>
      {id && detail.data ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Automation options">
            <Stack.Toolbar.MenuAction icon="pencil" onPress={() => router.push({ pathname: '/automation-edit', params: { id } })}>
              Edit
            </Stack.Toolbar.MenuAction>
            {detail.data.scope !== 'workspace' ? (
              <Stack.Toolbar.MenuAction
                icon="building.2"
                onPress={() => {
                  const automation = detail.data
                  if (!automation) return
                  const confirmation = moveToWorkspaceConfirmation(automation.name || automation.title || 'this automation', () =>
                    void action(() => moveToWorkspace('automations', id, { withAgent: Boolean(automation.agentId) })),
                  )
                  setConfirmation(
                    automation.agentId
                      ? { ...confirmation, message: `${confirmation.message} If its agent is yours and only you can use it, the agent moves too.` }
                      : confirmation,
                  )
                }}
              >
                Move to workspace
              </Stack.Toolbar.MenuAction>
            ) : null}
            <Stack.Toolbar.Menu inline title="">
              <Stack.Toolbar.MenuAction
                icon="trash"
                destructive
                onPress={() =>
                  setConfirmation({
                    title: `Delete “${detail.data?.name || detail.data?.title || 'this automation'}”?`,
                    message: 'Its schedule and run history will be removed. This can’t be undone.',
                    label: 'Delete automation',
                    destructive: true,
                    run: () =>
                      void action(async () => {
                        await deleteAutomation(id)
                        if (getRequestWorkspaceId() === workspaceId) setSelection({ scope: workspaceId, id: null })
                      }),
                  })
                }
              >
                Delete
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
      <RoomConfirmDialog request={confirmation} onClose={() => setConfirmation(null)} />
      <AutomationRunSheet
        key={`${workspaceId}:${id}:${selectedRun}`}
        visible={Boolean(selected)}
        automationId={id ?? ''}
        run={selected as AutomationRunSummary | null}
        approvalToken={
          selectedRun
            ? (tokens[selected?.workflowRunId ?? selectedRun] ?? tokens[selectedRun])
            : null
        }
        onClose={() => setSelectedRun(null)}
        onOpenChat={(conversationId) =>
          router.push({ pathname: '/chat/[id]', params: { id: conversationId } })
        }
        onChanged={() => {}}
      />
    </>
  )
}
