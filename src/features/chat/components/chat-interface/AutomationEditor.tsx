'use client'

import { lazy, Suspense, useMemo, useState } from 'react'
import { Button } from '@overlay/ui/primitives'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { getModelsByIntelligence } from '@/shared/ai/gateway/model-data'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useLiveAutomation, useLiveAutomationRuns } from '@/hooks/use-live-automations'
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
  buildAutomationUpdateRequest,
  formatAutomationRunError,
  supportedTimeZoneOptions,
} from '@overlay/app-core/automations'
import {
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

const NO_RUNS: AutomationRunSummary[] = []

function sameDraft(a: AutomationEditorDraft, b: AutomationEditorDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function AutomationEditorPanel({
  automation,
  onSaved,
  onTested,
}: {
  automation: AutomationDetail
  onSaved: (automation: AutomationDetail) => void
  onTested: (conversationId: string) => void
}) {
  const [draft, setDraft] = useState<AutomationEditorDraft>(() =>
    automationEditorDraftFromDetail(automation, DEFAULT_MODEL_ID),
  )
  const [saveState, setSaveState] = useState<AutomationSaveState>('idle')
  const [testState, setTestState] = useState<AutomationTestState>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)
  // Live: the definition from any tab or agent, and runs through admission, execution, retries and their end.
  const liveAutomation = useLiveAutomation(automation._id)
  const current = liveAutomation ?? automation
  const runs = useLiveAutomationRuns(automation._id) ?? NO_RUNS
  const [runsBusy, setRunsBusy] = useState(false)
  const [liveWorkflowRunId, setLiveWorkflowRunId] = useState<string | null>(null)
  const timeZoneOptions = useMemo(() => supportedTimeZoneOptions(), [])
  const modelOptions = useMemo(
    () =>
      getModelsByIntelligence().filter(
        (model) =>
          model.id !== 'nvidia/nemotron-nano-9b-v2' && !isByokModelId(model.id),
      ),
    [],
  )

  // A different automation starts fresh. A new version of this one replaces the form only while it has no unsaved
  // edits, so a change made elsewhere never overwrites what is being typed.
  const [prevAutomation, setPrevAutomation] = useState(current)
  if (prevAutomation !== current) {
    setPrevAutomation(current)
    const clean = sameDraft(draft, automationEditorDraftFromDetail(prevAutomation, DEFAULT_MODEL_ID))
    if (prevAutomation._id !== current._id || clean) setDraft(automationEditorDraftFromDetail(current, DEFAULT_MODEL_ID))
    if (prevAutomation._id !== current._id) {
      setSaveState('idle')
      setTestState('idle')
      setTestMessage(null)
      setLiveWorkflowRunId(null)
    }
  }

  function updateDraft(patch: Partial<AutomationEditorDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  async function saveAutomation() {
    if (!draft.name.trim() || !draft.instructions.trim()) return
    setSaveState('saving')
    try {
      const request = buildAutomationUpdateRequest({ automation: current, draft })
      const res = await overlayAppClient.automations.updateResponse(request)
      if (!res.ok) throw new Error('Failed to save automation')
      // Scheduling is owned by the minute cron claiming due runs: enabling sets nextRunAt and the next tick picks it
      // up. The live query brings the saved version (and its next run) back by itself.
      onSaved(applyAutomationUpdate(current, request))
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
      const res = await overlayAppClient.automations.runDurableResponse(
        automation._id,
      )
      const data = (await res.json().catch(() => ({}))) as {
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
      onModelIdChange={(modelId) => updateDraft({ modelId })}
      onSave={() => void saveAutomation()}
      onTest={() => void testAutomation()}
      // The flow surface is grandfathered: only automations whose graph was
      // hand-edited in the canvas get it — auto-derived graphs stay text-only.
      renderFlow={draft.graph?.manuallyEdited
        ? () => (
          <AutomationRunViewer
            graph={draft.graph!}
            runs={runs}
            workflowRunId={liveWorkflowRunId}
            onGraphChange={(graph) => updateDraft({ graph })}
          />
        )
        : undefined}
      renderInstructionsEditor={({ value, onChange }) => (
        <Suspense
          fallback={
            <div className="min-h-72 rounded-xl border border-(--border) bg-(--surface-elevated) p-4">
              <div className="ui-skeleton-line mb-3 h-4 w-40 rounded-sm" />
              <div className="ui-skeleton-line mb-2 h-3 w-full rounded-sm" />
              <div className="ui-skeleton-line mb-2 h-3 w-5/6 rounded-sm" />
              <div className="ui-skeleton-line h-3 w-2/3 rounded-sm" />
            </div>
          }
        >
          <AutomationInstructionsEditor value={value} onChange={onChange} />
        </Suspense>
      )}
      />
      {/* Matches the form's own `px-4` container above. Without the padding this
          section ran to the window edges while the cards stayed inset, and the
          border-t drew a full-width rule that nothing else in the page uses —
          the cards already separate the sections. */}
      <section className="mx-auto w-full max-w-4xl px-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className='text-sm font-semibold text-(--foreground)'>
              Run history
            </h2>
            <p className='mt-1 text-xs text-(--muted)'>
              Scheduled and manual execution records.
            </p>
          </div>
        </div>
        <div className="divide-y divide-(--border) border-y border-(--border)">
          {runs.length === 0 ? (
            <p className="py-5 text-sm text-(--muted)">No runs yet.</p>
          ) : (
            runs.slice(0, 50).map((run) => {
              const runError = formatAutomationRunError(
                run.error || run.errorMessage,
              )
            return (
                <div
                  key={run._id}
                  className='flex flex-wrap items-center justify-between gap-3 py-3'
                >
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize text-(--foreground)">
                    {run.status.replace('_', ' ')}
                  </p>
                  <p className="mt-1 text-xs text-(--muted)">
                      {
                        // Locale pinned to 'en-US' — SSR and client output are identical.
                        // react-doctor-disable-next-line react-doctor/no-locale-format-in-render
                        new Date(run.scheduledFor).toLocaleString('en-US')
                      }
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
                      className="rounded-md border border-(--border) px-2.5 py-1.5 text-xs"
                      href={`/app/automations?id=${encodeURIComponent(run.conversationId)}&automationId=${encodeURIComponent(automation._id)}`}
                    >
                      Open
                    </a>
                  ) : null}
                  {run.status === 'queued' || run.status === 'running' ? (
                    <Button
                      variant="ghost"
                      type="button"
                      className="h-auto rounded-md border border-(--border) px-2.5 py-1.5 text-xs font-normal text-(--foreground) hover:bg-transparent"
                      disabled={runsBusy}
                      onClick={() => void updateRun('cancel-run', run._id)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                  {run.status === 'failed' || run.status === 'dead_letter' || run.status === 'cancelled' ? (
                    <Button
                      variant="ghost"
                      type="button"
                      className="h-auto rounded-md border border-(--border) px-2.5 py-1.5 text-xs font-normal text-(--foreground) hover:bg-transparent"
                      disabled={runsBusy}
                      onClick={() => void updateRun('retry-run', run._id)}
                    >
                      Retry
                    </Button>
                  ) : null}
                </div>
              </div>
            )
            })
          )}
        </div>
      </section>
    </div>
  )
}
