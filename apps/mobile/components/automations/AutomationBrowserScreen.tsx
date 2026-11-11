import React, { useState } from 'react'
import { Alert } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { AutomationRunSummary, AutomationSummary } from '@overlay/app-core'
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
  ResourceRow,
  ResourceSheet,
  ResourceState,
  RUN_TERMINAL,
} from '../knowledge/ResourceViews'
import { FeatureGate } from '../ui/FeatureGate'
import { AutomationEditorSheet } from './AutomationEditorSheet'
import { AutomationRunSheet } from './AutomationRunSheet'
import { formatSchedule } from '../../lib/automationSchedule'

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
  const scope = enabled ? workspaceId : null
  const items = useLiveResource(
    api.automations.browse.list,
    scope ? { workspaceId: scope, includeAgentBound: true } : null,
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
  const [edit, setEdit] = useState<{ scope: string; item: AutomationSummary | null } | null>(null)
  const [options, setOptions] = useState(false)
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [tokens, setTokens] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
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
        section="Automations"
        topInset={top}
        onDrawer={openDrawer}
        onBack={
          id
            ? () => {
                setSelection({ scope: workspaceId, id: null })
                setError(null)
              }
            : undefined
        }
        onSearch={() => router.push('/search')}
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
                    const result = await runAutomationNow(id)
                    if (result.ok === false || result.error)
                      throw new Error(result.error || result.message || 'Could not start run.')
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
                onEdit={() => setOptions(true)}
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
            onNew={() => {
              if (workspaceId) setEdit({ scope: workspaceId, item: null })
            }}
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
      <ResourceSheet
        theme={theme}
        title="Automation options"
        visible={options && Boolean(detail.data)}
        onClose={() => setOptions(false)}
      >
        <ResourceRow
          theme={theme}
          title="Edit automation"
          onPress={() => {
            setOptions(false)
            if (workspaceId && detail.data) setEdit({ scope: workspaceId, item: detail.data })
          }}
        />
        <ResourceRow
          theme={theme}
          title="Delete automation"
          onPress={() =>
            Alert.alert('Delete automation?', 'This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  if (id)
                    void action(async () => {
                      await deleteAutomation(id)
                      if (getRequestWorkspaceId() === workspaceId) {
                        setOptions(false)
                        setSelection({ scope: workspaceId, id: null })
                      }
                    })
                },
              },
            ])
          }
        />
      </ResourceSheet>
      <AutomationEditorSheet
        key={workspaceId}
        visible={edit?.scope === workspaceId}
        automation={edit?.scope === workspaceId ? edit.item : null}
        onClose={() => setEdit(null)}
        onSaved={() => setEdit(null)}
      />
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
