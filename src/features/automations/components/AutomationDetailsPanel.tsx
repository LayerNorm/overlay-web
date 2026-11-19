'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CirclePlay, Trash2 } from 'lucide-react'
import type { AutomationDetail, AutomationRunSummary } from '@overlay/app-core'
import { getAutomationDisplayName, supportedTimeZoneOptions } from '@overlay/app-core/automations'
import type { ChatModel } from '@overlay/chat-core'
import { ChatModelPicker } from '@overlay/chat-react'
import { RightSidebar } from '@overlay/modules-react/shell'
import { Button, Command, CommandInput, CommandItem, CommandList, Switch, toast } from '@overlay/ui/primitives'
import { MODEL_RECOMMENDATIONS } from '@/shared/ai/gateway/model-data'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchChatDeleted } from '@/shared/chat/chat-title'
import { useLiveAutomation, useLiveAutomationRuns } from '@/hooks/use-live-automations'
import {
  browserTimeZone, formatRunTime, scheduleDraftFromSchedule, scheduleFromDraft, scheduleLabel, timeZoneLabel,
  type ScheduleDraft,
} from '../lib/automation-schedule'
import { AutomationAvatar, ScheduleFields, useAutomationAgents } from './AutomationComposerPickers'
import { DetailsDisclosure, InlineName, RunRow } from './AutomationDetailsPanel.parts'

export const AUTOMATION_PANEL_WIDTH = 380

export type AutomationModelField = {
  models: ChatModel[]
  modelId: string
  modelLabel: string
  onModelChange: (modelId: string) => void
  favoriteScope: string | null
  textModelsLoading: boolean
  isTextModelLocked?: (modelId: string) => boolean
  onLockedTextModelSelect?: (model: ChatModel) => void
}

const NO_RUNS: AutomationRunSummary[] = []
const RECENT_RUN_COUNT = 5

async function patchAutomation(body: Parameters<typeof overlayAppClient.automations.update>[0], failure: string) {
  try {
    const result = await overlayAppClient.automations.update(body)
    if (result.success === false) throw new Error(result.error || failure)
  } catch (error) {
    toast.error(error instanceof Error && error.message ? error.message : failure)
  }
}

function AutomationDetails({ automation, model }: { automation: AutomationDetail; model: AutomationModelField }) {
  const router = useRouter()
  const runs = useLiveAutomationRuns(automation._id) ?? NO_RUNS
  const agents = useAutomationAgents()
  const timeZoneOptions = useMemo(() => supportedTimeZoneOptions(), [])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState<'toggle' | 'run' | 'delete' | null>(null)
  const timeZone = automation.timezone || browserTimeZone()
  const schedule = scheduleDraftFromSchedule(automation.schedule, timeZone)
  const enabled = automation.enabled !== false
  const agent = automation.agentId ? agents.find((entry) => entry.id === automation.agentId) : null

  const saveSchedule = (next: ScheduleDraft, nextTimeZone = timeZone) => patchAutomation({
    automationId: automation._id,
    schedule: scheduleFromDraft(next),
    timezone: nextTimeZone,
  }, 'Could not save the schedule.')

  const toggleEnabled = async (next: boolean) => {
    setBusy('toggle')
    await patchAutomation({ automationId: automation._id, action: next ? 'resume' : 'pause' }, next ? 'Could not resume the automation.' : 'Could not pause the automation.')
    setBusy(null)
  }

  const runNow = async () => {
    setBusy('run')
    try {
      await overlayAppClient.automations.runDurable(automation._id)
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not start a run.')
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('delete')
    try {
      const response = await overlayAppClient.automations.deleteResponse({ automationId: automation._id })
      if (!response.ok) throw new Error('Could not delete the automation.')
      const payload = await overlayAppClient.automations.parseDeleteResponse(response).catch(() => ({ linkedConversationIds: [] }))
      for (const chatId of payload.linkedConversationIds ?? []) dispatchChatDeleted({ chatId })
      router.push('/app/automations')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the automation.')
      setBusy(null)
    }
  }

  return (
    <div className="space-y-[22px]">
      <div className="space-y-3">
        <div className="flex items-center gap-3 px-1">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-(--foreground)">{enabled ? 'Active' : 'Paused'}</p>
            <p className="mt-0.5 text-xs text-(--muted)">
              {!enabled
                ? 'Runs are off until you turn them back on'
                : automation.nextRunAt ? 'Next run: ' + formatRunTime(automation.nextRunAt) : 'Next run not scheduled'}
            </p>
          </div>
          <Switch checked={enabled} disabled={busy === 'toggle'} aria-label="Active" onCheckedChange={(next) => void toggleEnabled(next)} />
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={busy === 'run'} onClick={() => void runNow()} className="w-full gap-1.5">
          <CirclePlay size={14} />Run now
        </Button>
      </div>
      <DetailsDisclosure label="Schedule" summary={scheduleLabel(schedule)}>
        <ScheduleFields value={schedule} onChange={(next) => void saveSchedule(next)} />
      </DetailsDisclosure>
      <DetailsDisclosure label="Time zone" summary={timeZoneLabel(timeZone)}>
        <Command>
          <CommandInput placeholder="Search time zones" />
          <CommandList className="max-h-56">
            {timeZoneOptions.map((option) => (
              <CommandItem key={option.value} value={option.label + ' ' + option.value} onSelect={() => void saveSchedule(schedule, option.value)}>
                <span className="flex-1 truncate">{option.label}</span>
                {option.value === timeZone ? <Check size={14} /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DetailsDisclosure>
      <div className="flex h-8 items-center gap-3 px-1 text-xs">
        <span className="shrink-0 font-medium text-(--muted)">Agent</span>
        <span className="ml-auto flex min-w-0 items-center gap-1.5 text-(--muted-light)">
          <AutomationAvatar agent={agent} size={14} />
          <span className="truncate">{agent?.name ?? (automation.agentId ? 'Agent' : 'No agent')}</span>
        </span>
      </div>
      {/* An agent automation runs on the agent's own model; only a chat automation has a model of its own. */}
      {automation.agentId ? (
        <div className="flex h-8 items-center gap-3 px-1 text-xs">
          <span className="shrink-0 font-medium text-(--muted)">Model</span>
          <span className="ml-auto truncate text-(--muted-light)">The agent’s model</span>
        </div>
      ) : (
      <DetailsDisclosure label="Model" summary={model.modelLabel}>
        <ChatModelPicker
          placement="field"
          modelPickerLabel={model.modelLabel}
          selectableTextModels={model.models}
          selectedActModel={model.modelId}
          onToggleTextModel={model.onModelChange}
          isTextModelLocked={model.isTextModelLocked}
          onLockedTextModelSelect={model.onLockedTextModelSelect}
          favoriteScope={model.favoriteScope}
          modelRecommendations={MODEL_RECOMMENDATIONS}
          textModelsLoading={model.textModelsLoading}
          generationMode="text"
          lockedGenerationMode="text"
        />
      </DetailsDisclosure>
      )}
      <section aria-label="Recent runs">
        <h3 className="flex h-8 items-center px-1 text-xs font-medium text-(--muted)">Recent runs</h3>
        {runs.length ? (
          <ul>
            {runs.slice(0, RECENT_RUN_COUNT).map((run) => (
              <RunRow
                key={run._id}
                run={run}
                onRetry={() => void patchAutomation({ automationId: automation._id, action: 'retry-run', runId: run._id }, 'Could not retry the run.')}
              />
            ))}
          </ul>
        ) : (
          <p className="px-1 text-xs text-(--muted-light)">No runs yet</p>
        )}
      </section>
      <div className="border-t border-(--border) pt-3">
        {confirmDelete ? (
          <div className="flex items-center gap-2 px-1 text-xs text-(--muted)">
            <span className="flex-1">Delete this automation and its chat?</span>
            <Button type="button" variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={busy === 'delete'}
              className="text-red-600 hover:text-red-600 dark:text-red-400"
              onClick={() => void remove()}
            >
              Delete
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            className="h-8 gap-1.5 px-1 text-xs font-normal text-(--muted) hover:text-red-600 dark:hover:text-red-400"
          >
            <Trash2 size={14} />Delete automation
          </Button>
        )}
      </div>
    </div>
  )
}

/** An automation's thread docks this panel where agent threads dock theirs. Live through every edit and run. */
export function AutomationDetailsPanel({ automation: initial, model, onClose }: {
  automation: AutomationDetail
  model: AutomationModelField
  onClose: () => void
}) {
  const live = useLiveAutomation(initial._id)
  const automation = live ?? initial
  const agents = useAutomationAgents()
  const agent = automation.agentId ? agents.find((entry) => entry.id === automation.agentId) : null
  const name = getAutomationDisplayName(automation)
  const timeZone = automation.timezone || browserTimeZone()
  return (
    <RightSidebar
      ariaLabel="Automation sidebar"
      hero={{
        avatar: <AutomationAvatar agent={agent} size={64} />,
        title: (
          <InlineName
            value={name}
            onCommit={(next) => void patchAutomation({ automationId: automation._id, name: next }, 'Could not rename the automation.')}
          />
        ),
        titleText: name,
        subtitle: scheduleLabel(scheduleDraftFromSchedule(automation.schedule, timeZone)),
      }}
      tabs={[{ id: 'automation', label: 'Automation', content: <AutomationDetails automation={automation} model={model} /> }]}
      activeTab="automation"
      onTabChange={() => {}}
      onClose={onClose}
    />
  )
}

/** Open by default on wide screens, like the agent sidebar. */
export function useAutomationPanelOpen() {
  return useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches)
}
