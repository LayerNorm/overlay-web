'use client'

import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Clock } from 'lucide-react'
import {
  Button, Command, CommandGroup, CommandItem, CommandList, Input, Popover, PopoverContent, PopoverTrigger, toast,
} from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { DelayedTooltip } from '@overlay/ui/overlays'
import { WEEKDAY_LABELS, automationHref } from '@overlay/app-core/automations'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { newItemScope, type PanelScope } from '@/shared/workspaces/panel-scope'
import { agentBelongsToCreatorScope } from '@/shared/agents/last-agent-by-workspace'
import { AgentCreature } from '@/components/orb/Creature'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAgentDirectory } from '@/hooks/use-agent-directory'
import { usePanelScope } from '@/hooks/use-panel-scope'
import {
  DEFAULT_SCHEDULE_DRAFT, MAX_MONTH_DAY, SCHEDULE_FREQUENCIES, browserTimeZone, scheduleFromDraft, scheduleLabel,
  timeZoneLabel, type ScheduleDraft,
} from '../lib/automation-schedule'

/** No agent is a plain Overlay chat, shown with the Overlay mark; an agent shows its creature. */
export function AutomationAvatar({ agent, size = 16 }: { agent: WorkspaceAgentDirectoryItem | null | undefined; size?: number }) {
  return agent
    ? <AgentCreature agent={agent} isDefault={agent.isDefault} size={size} />
    : <AgentCreature agent={{ name: 'Overlay' }} isDefault size={size} />
}

/**
 * The workspace's agents an automation can run as, the default Overlay agent aside ("No agent" covers it).
 * With a scope, only the agents the Agents sidebar lists in that scope, so each personal Overlay appears once.
 */
export function useAutomationAgents(scope?: PanelScope): WorkspaceAgentDirectoryItem[] {
  const directory = useAgentDirectory()
  const { activeWorkspaceId } = useWorkspace()
  return useMemo(
    () => directory.workspaceId === activeWorkspaceId
      ? (directory.agents ?? []).filter((agent) => !agent.isDefault
        && (!scope || agentBelongsToCreatorScope(agent, directory.viewerPrincipalId, scope)))
      : [],
    [activeWorkspaceId, directory.agents, directory.viewerPrincipalId, directory.workspaceId, scope],
  )
}

const COMPOSER_TRIGGER = 'flex h-9 min-w-0 max-w-44 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-left text-xs leading-none text-(--muted) transition-colors hover:bg-(--surface-muted) hover:text-(--foreground) max-sm:w-8 max-sm:justify-center max-sm:gap-0 max-sm:px-0'

/** A picker beside the composer's model control, sharing its trigger style; icon-only on narrow screens. */
function ComposerPicker({ label, tooltip, icon, width, children }: {
  label: string
  tooltip: string
  icon: ReactNode
  width: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <DelayedTooltip label={tooltip} side="top">
        <PopoverTrigger asChild>
          <Button variant="ghost" type="button" aria-label={tooltip + ': ' + label} className={unstyledButton(COMPOSER_TRIGGER)}>
            {icon}
            <span className="truncate max-sm:hidden">{label}</span>
          </Button>
        </PopoverTrigger>
      </DelayedTooltip>
      <PopoverContent align="end" side="top" className={'max-w-[calc(100vw-2rem)] p-1 ' + width}>
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  )
}

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]

export function ScheduleFields({ value, onChange, timeZone }: {
  value: ScheduleDraft
  onChange: (next: ScheduleDraft) => void
  /** Shown muted below the fields when the time zone has no row of its own. */
  timeZone?: string
}) {
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...value, ...patch })
  return (
    <div className="grid">
      <div role="radiogroup" aria-label="Repeats" className="grid">
        {SCHEDULE_FREQUENCIES.map(({ frequency, label }) => (
          <Button
            key={frequency}
            type="button"
            variant="ghost"
            size="sm"
            role="radio"
            aria-checked={value.frequency === frequency}
            onClick={() => set(frequency === 'interval' ? { frequency, intervalMinutes: 60 } : { frequency })}
            className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal text-(--foreground)"
          >
            <span className="flex-1 text-left">{label}</span>
            {value.frequency === frequency ? <Check size={14} /> : null}
          </Button>
        ))}
      </div>
      {value.frequency !== 'interval' || timeZone ? (
        <div className="mt-1 grid gap-2.5 border-t border-(--border) px-2 pb-1.5 pt-2.5">
          {value.frequency === 'weekly' ? (
            <div role="radiogroup" aria-label="Day" className="flex justify-between">
              {MONDAY_FIRST.map((day) => (
                <Button
                  key={day}
                  type="button"
                  size="icon-xs"
                  variant={value.weekday === day ? 'secondary' : 'ghost'}
                  role="radio"
                  aria-checked={value.weekday === day}
                  aria-label={WEEKDAY_LABELS[day]}
                  onClick={() => set({ weekday: day })}
                  className="size-7 text-xs font-normal"
                >
                  {WEEKDAY_LABELS[day]![0]}
                </Button>
              ))}
            </div>
          ) : null}
          {value.frequency === 'monthly' ? (
            <label className="flex items-center justify-between gap-3 text-xs text-(--muted)">
              Day of the month
              <Input
                type="number"
                min={1}
                max={MAX_MONTH_DAY}
                value={value.monthDay}
                onChange={(event) => set({ monthDay: Math.min(MAX_MONTH_DAY, Math.max(1, Number(event.target.value) || 1)) })}
                className="h-8 w-16 text-sm"
              />
            </label>
          ) : null}
          {value.frequency !== 'interval' ? (
            <label className="flex items-center justify-between gap-3 text-xs text-(--muted)">
              Time
              <Input
                type="time"
                value={value.time}
                onChange={(event) => { if (event.target.value) set({ time: event.target.value }) }}
                className="h-8 w-32 text-sm"
              />
            </label>
          ) : null}
          {timeZone ? <p className="text-[11px] text-(--muted-light)">{timeZoneLabel(timeZone)}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function AgentOptions({ agents, value, onChange }: {
  agents: WorkspaceAgentDirectoryItem[]
  value: string | null
  onChange: (next: string | null) => void
}) {
  return (
    <Command>
      <CommandList>
        <CommandItem value="No agent" onSelect={() => onChange(null)}>
          <AutomationAvatar agent={null} size={18} />
          <span className="flex-1 truncate">No agent</span>
          {!value ? <Check size={14} /> : null}
        </CommandItem>
        {agents.length ? (
          <CommandGroup heading="Agents">
            {agents.map((agent) => (
              <CommandItem key={agent.id} value={agent.name + ' ' + agent.id} onSelect={() => onChange(agent.id)}>
                <AutomationAvatar agent={agent} size={18} />
                <span className="flex-1 truncate">{agent.name}</span>
                {agent.id === value ? <Check size={14} /> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  )
}

type ComposerEditor = { getPlainText(): string; clear(): void; getMentions?(): readonly unknown[] }

/**
 * The new-automation composer: Schedule and Agent beside the model control, and a send that creates the automation
 * with the composer's model, runs it once and opens its thread. Null outside a new automation.
 */
export function useNewAutomationComposer({ enabled, modelId, textareaRef, onInputChange, attachmentCount }: {
  enabled: boolean
  modelId: string
  /** Images and documents in the composer. Instructions are plain text, so they cannot be carried into an automation. */
  attachmentCount: number
  textareaRef: RefObject<ComposerEditor | null>
  onInputChange: (text: string) => void
}): { composerControls: ReactNode; onSend: () => Promise<void>; placeholder: string } | null {
  const router = useRouter()
  const panelScope = usePanelScope()
  const agents = useAutomationAgents(panelScope)
  const [schedule, setSchedule] = useState<ScheduleDraft>(DEFAULT_SCHEDULE_DRAFT)
  const [agentId, setAgentId] = useState<string | null>(null)
  // A ref, not state: two quick presses of Enter both see state as false and would create two automations.
  const creatingRef = useRef(false)
  const [timeZone] = useState(browserTimeZone)
  if (!enabled) return null
  const agent = agents.find((entry) => entry.id === agentId) ?? null

  const onSend = async () => {
    const instructions = textareaRef.current?.getPlainText().trim() ?? ''
    if (!instructions || creatingRef.current) return
    // Instructions are saved as plain text, so attachments and @mentions (which point at files, agents or people by
    // id) would be dropped silently. Ask for them to be removed instead.
    if (attachmentCount > 0 || (textareaRef.current?.getMentions?.().length ?? 0) > 0) {
      toast.error('Automations can’t include attachments or @mentions yet. Remove them, or describe what to use in the instructions.')
      return
    }
    creatingRef.current = true
    try {
      const created = await overlayAppClient.automations.create({
        instructions,
        schedule: scheduleFromDraft(schedule),
        timezone: timeZone,
        // An agent automation runs on the agent's own model, so only a chat automation saves the composer's model.
        ...(agent ? {} : { modelId }),
        enabled: true,
        scope: newItemScope(panelScope),
        ...(agent ? { agentId: agent.id } : {}),
      })
      if (!created.id) throw new Error(created.error || 'Could not create the automation.')
      textareaRef.current?.clear()
      onInputChange('')
      setSchedule(DEFAULT_SCHEDULE_DRAFT)
      setAgentId(null)
      const run = await overlayAppClient.automations.runDurable(created.id).catch(() => null)
      if (!run?.conversationId) toast.error('The automation was created, but its first run did not start.')
      router.push(automationHref({ _id: created.id, conversationId: run?.conversationId }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the automation.')
    } finally {
      creatingRef.current = false
    }
  }

  return {
    placeholder: 'What should run on a schedule?',
    onSend,
    composerControls: (
      <>
        <ComposerPicker tooltip="Schedule" label={scheduleLabel(schedule)} icon={<Clock size={14} className="shrink-0" />} width="w-64">
          {() => <ScheduleFields value={schedule} onChange={setSchedule} timeZone={timeZone} />}
        </ComposerPicker>
        <ComposerPicker tooltip="Agent" label={agent?.name ?? 'No agent'} icon={<AutomationAvatar agent={agent} />} width="w-56">
          {(close) => <AgentOptions agents={agents} value={agentId} onChange={(next) => { setAgentId(next); close() }} />}
        </ComposerPicker>
      </>
    ),
  }
}
