'use client'

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { getModelsByIntelligence } from '@/shared/ai/gateway/model-data'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type {
  AutomationDetail,
  AutomationDetailTab,
  AutomationEditorDraft,
  AutomationSaveState,
  AutomationSchedule,
  AutomationRunSummary,
  AutomationTestState,
} from '@overlay/app-core'
import {
  applyAutomationUpdate,
  automationEditorDraftFromDetail,
  AUTOMATIONS_UPDATED_EVENT,
  buildAutomationUpdateRequest,
  formatAutomationRunError,
  normalizeAutomationDetailTab,
  supportedTimeZoneOptions,
} from '@overlay/app-core/automations'
import {
  AUTOMATION_DETAIL_TABS,
  AutomationEditorForm,
  AutomationRunViewer,
} from '@overlay/modules-react/automations'

const AutomationInstructionsEditor = lazy(() =>
  import('@/features/notebook/components/AutomationInstructionsEditor').then((mod) => ({
    default: mod.AutomationInstructionsEditor,
  })),
)

export type {
  AutomationDetail,
  AutomationDetailTab,
  AutomationSchedule,
}
export { AUTOMATION_DETAIL_TABS, normalizeAutomationDetailTab }

export function AutomationEditorPanel({
  automation,
  onSaved,
  onTested,
  isFreeTier,
}: {
  automation: AutomationDetail
  onSaved: (automation: AutomationDetail) => void
  onTested: (conversationId: string) => void
  isFreeTier: boolean
}) {
  const [draft, setDraft] = useState<AutomationEditorDraft>(() => (
    automationEditorDraftFromDetail(automation, DEFAULT_MODEL_ID)
  ))
  const [saveState, setSaveState] = useState<AutomationSaveState>('idle')
  const [testState, setTestState] = useState<AutomationTestState>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [runs, setRuns] = useState<AutomationRunSummary[]>([])
  const [runsBusy, setRunsBusy] = useState(false)
  const [liveWorkflowRunId, setLiveWorkflowRunId] = useState<string | null>(null)
  const timeZoneOptions = useMemo(() => supportedTimeZoneOptions(), [])
  const modelOptions = useMemo(
    () => getModelsByIntelligence(isFreeTier).filter((model) => model.id !== 'nvidia/nemotron-nano-9b-v2'),
    [isFreeTier],
  )

  const loadRuns = useCallback(async () => {
    const nextRuns = await overlayAppClient.automations.getRuns(
      automation._id,
      { cache: 'no-store' },
    )
    setRuns(Array.isArray(nextRuns) ? nextRuns : [])
  }, [automation._id])

  useEffect(() => {
    setDraft(automationEditorDraftFromDetail(automation, DEFAULT_MODEL_ID))
    setSaveState('idle')
    setTestState('idle')
    setTestMessage(null)
    setLiveWorkflowRunId(null)
  }, [automation])

  useEffect(() => {
    void loadRuns().catch(() => setRuns([]))
  }, [loadRuns])

  function updateDraft(patch: Partial<AutomationEditorDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  async function saveAutomation() {
    if (!draft.name.trim() || !draft.instructions.trim()) return
    setSaveState('saving')
    try {
      const request = buildAutomationUpdateRequest({ automation, draft })
      const res = await overlayAppClient.automations.updateResponse(request)
      if (!res.ok) throw new Error('Failed to save automation')
      if (draft.enabled && automation.enabled !== true) {
        const schedulerRes = await overlayAppClient.automations.startSchedulerResponse(automation._id)
        if (!schedulerRes.ok) throw new Error('Failed to start automation scheduler')
      }
      const refreshedRes = await overlayAppClient.automations.getResponse(
        { automationId: automation._id },
        { credentials: 'same-origin', cache: 'no-store' },
      )
      if (!refreshedRes.ok) throw new Error('Failed to reload saved automation')
      const refreshed = await refreshedRes.json() as AutomationDetail
      const updated = refreshed?._id === automation._id
        ? refreshed
        : applyAutomationUpdate(automation, request)
      setDraft(automationEditorDraftFromDetail(updated, DEFAULT_MODEL_ID))
      onSaved(updated)
      window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
      setSaveState('saved')
      window.setTimeout(() => setSaveState('idle'), 1500)
    } catch {
      setSaveState('error')
    }
  }

  async function testAutomation() {
    setTestState('running')
    setTestMessage(null)
    try {
      // Durable path: trigger via the per-automation run endpoint, capture
      // the workflowRunId for live visualization, then open the chat.
      const res = await overlayAppClient.automations.runDurableResponse(automation._id)
      const data = await res.json().catch(() => ({})) as {
        workflowRunId?: string
        runId?: string
        conversationId?: string
        error?: string
        message?: string
      }
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to test automation')
      }
      if (data.workflowRunId) {
        setLiveWorkflowRunId(data.workflowRunId)
      }
      setTestState('success')
      setTestMessage('Durable run started. Live status available in Run Visualization below.')
      // Refresh runs list so the new run appears in the replay dropdown
      void loadRuns()
      // Don't navigate away immediately — let the user watch live status.
      // The user can click "Open" in run history to view the chat.
      if (data.conversationId) {
        // Optionally navigate after a short delay to let the user see live status
        window.setTimeout(() => onTested(data.conversationId!), 3000)
      }
    } catch (error) {
      setTestState('error')
      setTestMessage(error instanceof Error ? error.message : 'Failed to test automation')
    }
  }

  async function updateRun(action: 'cancel-run' | 'retry-run', runId: string) {
    setRunsBusy(true)
    try {
      const response = await overlayAppClient.automations.updateResponse({
        action,
        automationId: automation._id,
        runId,
      })
      if (!response.ok) throw new Error('Run operation failed')
      await loadRuns()
    } finally {
      setRunsBusy(false)
    }
  }

  return (
    <div className="space-y-8 pb-8">
      <AutomationEditorForm
      name={draft.name}
      description={draft.description}
      instructions={draft.instructions}
      enabled={draft.enabled}
      scheduleKind={draft.scheduleKind}
      intervalMinutes={draft.intervalMinutes}
      timezone={draft.timezone}
      time={draft.time}
      dayOfWeek={draft.dayOfWeek}
      dayOfMonth={draft.dayOfMonth}
      graphSource={draft.graphSource}
      graph={draft.graph}
      modelId={draft.modelId}
      timeZoneOptions={timeZoneOptions}
      modelOptions={modelOptions}
      saveState={saveState}
      testState={testState}
      testMessage={testMessage}
      onGraphChange={(graph) => updateDraft({ graph })}
      onNameChange={(name) => updateDraft({ name })}
      onDescriptionChange={(description) => updateDraft({ description })}
      onInstructionsChange={(instructions) => updateDraft({ instructions })}
      onEnabledChange={(enabled) => updateDraft({ enabled })}
      onScheduleKindChange={(scheduleKind) => updateDraft({ scheduleKind })}
      onIntervalMinutesChange={(intervalMinutes) => updateDraft({ intervalMinutes })}
      onTimezoneChange={(timezone) => updateDraft({ timezone })}
      onTimeChange={(time) => updateDraft({ time })}
      onDayOfWeekChange={(dayOfWeek) => updateDraft({ dayOfWeek })}
      onDayOfMonthChange={(dayOfMonth) => updateDraft({ dayOfMonth })}
      onGraphSourceChange={(graphSource) => updateDraft({ graphSource })}
      onModelIdChange={(modelId) => updateDraft({ modelId })}
      onSave={() => void saveAutomation()}
      onTest={() => void testAutomation()}
      renderInstructionsEditor={({ value, onChange }) => (
        <Suspense
          fallback={
            <div className="min-h-[18rem] rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
              <div className="ui-skeleton-line mb-3 h-4 w-40 rounded" />
              <div className="ui-skeleton-line mb-2 h-3 w-full rounded" />
              <div className="ui-skeleton-line mb-2 h-3 w-5/6 rounded" />
              <div className="ui-skeleton-line h-3 w-2/3 rounded" />
            </div>
          }
        >
          <AutomationInstructionsEditor value={value} onChange={onChange} />
        </Suspense>
      )}
      />
      {draft.graph && draft.graph.nodes.length > 0 && (
        <section className="mx-auto w-full max-w-3xl border-t border-[var(--border)] pt-6">
          <AutomationRunViewer
            graph={draft.graph}
            runs={runs}
            workflowRunId={liveWorkflowRunId}
          />
        </section>
      )}
      <section className="mx-auto w-full max-w-3xl border-t border-[var(--border)] pt-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Run history</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">Scheduled and manual execution records.</p>
          </div>
          <button
            type="button"
            aria-label="Refresh automation runs"
            className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] disabled:opacity-50"
            disabled={runsBusy}
            onClick={() => void loadRuns()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {runs.length === 0 ? (
            <p className="py-5 text-sm text-[var(--muted)]">No runs yet.</p>
          ) : runs.slice(0, 50).map((run) => {
            const runError = formatAutomationRunError(run.error || run.errorMessage)
            return (
              <div key={run._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize text-[var(--foreground)]">
                    {run.status.replace('_', ' ')}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {new Date(run.scheduledFor).toLocaleString()}
                    {run.triggerSource ? ` · ${run.triggerSource}` : ''}
                  </p>
                  {runError ? (
                    <p className="mt-1 max-w-2xl truncate text-xs text-red-600 dark:text-red-400">
                      {runError}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {run.conversationId ? (
                    <a
                      className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs"
                      href={`/app/automations?id=${encodeURIComponent(run.conversationId)}&automationId=${encodeURIComponent(automation._id)}`}
                    >
                      Open
                    </a>
                  ) : null}
                  {run.status === 'queued' || run.status === 'running' ? (
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs"
                      disabled={runsBusy}
                      onClick={() => void updateRun('cancel-run', run._id)}
                    >
                      Cancel
                    </button>
                  ) : null}
                  {run.status === 'failed' || run.status === 'dead_letter' || run.status === 'cancelled' ? (
                    <button
                      type="button"
                      className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs"
                      disabled={runsBusy}
                      onClick={() => void updateRun('retry-run', run._id)}
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
