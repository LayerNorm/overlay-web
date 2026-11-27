import React, { useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import {
  Button,
  ContextMenu,
  DatePicker,
  Form,
  HStack,
  Host,
  Image as Symbol,
  Menu,
  Picker,
  RNHostView,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
} from '@expo/ui/swift-ui'
import {
  datePickerStyle,
  foregroundStyle,
  lineLimit,
  menuActionDismissBehavior,
  pickerStyle,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import type { MoveWorkItemRequest, WorkItem, WorkPerson, WorkStatus } from '@overlay/app-core'
import { taskSpan } from '../../../../src/shared/work/dates'
import { applyDrag } from '../../../../src/shared/work/timeline'
import { validateWorkDates } from '../../../../src/shared/work/status'
import { sortByRank } from '../../../../src/shared/work/query'
import { parseWorkErrorReason, workErrorMessage } from '../../../../src/shared/work/errors'
import { useTheme } from '../../hooks/useTheme'
import { useWork } from '../../hooks/useWork'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useSwitchTint } from '../../lib/nativeControls'
import {
  availableWorkPeople,
  dependencyChoices,
  fromWorkDate,
  toggleDependency,
  toWorkDate,
  workRequest,
  WORK_STATUSES,
  WORK_STATUS_LABELS,
} from '../../lib/work'
import { createWork, updateWork } from '../../services/workService'
import { getRequestWorkspaceId } from '../../services/appApi'
import { SwipeRow } from '../ui/SwipeRow'

export const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })

export function workError(reason: unknown, fallback: string) {
  const code = parseWorkErrorReason(reason)
  return code ? workErrorMessage(code) : reason instanceof Error ? reason.message : fallback
}

/** A switch per date; turning it on reveals a compact native date picker. */
export function WorkDateRows({
  start,
  due,
  onChange,
}: {
  start: string | null
  due: string | null
  onChange: (dates: { startDate: string | null; dueDate: string | null }) => void
}) {
  const switchTint = useSwitchTint()
  const today = toWorkDate(new Date())
  const row = (label: string, value: string | null, set: (next: string | null) => void) => (
    <>
      <Toggle modifiers={switchTint} label={label} isOn={Boolean(value)} onIsOnChange={(on) => set(on ? (value ?? today) : null)} />
      {value ? (
        <DatePicker
          title={label === 'Start date' ? 'Starts' : 'Due'}
          selection={fromWorkDate(value)}
          displayedComponents={['date']}
          onDateChange={(date) => set(toWorkDate(date))}
          modifiers={[datePickerStyle('compact')]}
        />
      ) : null}
    </>
  )
  return (
    <>
      {row('Start date', start, (startDate) => onChange({ startDate, dueDate: due }))}
      {row('Due date', due, (dueDate) => onChange({ startDate: start, dueDate }))}
    </>
  )
}

export function WorkAssigneePicker({
  people,
  value,
  onChange,
}: {
  people: readonly WorkPerson[]
  value: string
  onChange: (principalId: string) => void
}) {
  return (
    <Picker label="Assignee" selection={value} onSelectionChange={(id: string) => onChange(id)} modifiers={[pickerStyle('menu')]}>
      <Text modifiers={[tag('')]}>Unassigned</Text>
      {people.map((person) => (
        <Text key={person.principalId} modifiers={[tag(person.principalId)]}>
          {person.displayName}
        </Text>
      ))}
    </Picker>
  )
}

export function WorkStatusPicker({ value, onChange }: { value: WorkStatus; onChange: (status: WorkStatus) => void }) {
  return (
    <Picker label="Status" selection={value} onSelectionChange={(status: WorkStatus) => onChange(status)} modifiers={[pickerStyle('menu')]}>
      {WORK_STATUSES.map((status) => (
        <Text key={status} modifiers={[tag(status)]}>
          {WORK_STATUS_LABELS[status]}
        </Text>
      ))}
    </Picker>
  )
}

/** "Depends on" row: a menu that stays open while you tick tasks. */
export function WorkDependsOnMenu({
  choices,
  selected,
  onToggle,
}: {
  choices: readonly WorkItem[]
  selected: readonly string[]
  onToggle: (id: string) => void
}) {
  const count = selected.length
  return (
    <Menu
      label={
        <HStack spacing={6}>
          <Text>Depends on</Text>
          <Spacer />
          <Text modifiers={[secondary]}>{count ? `${count} task${count === 1 ? '' : 's'}` : 'Nothing'}</Text>
          <Symbol systemName="chevron.up.chevron.down" size={12} modifiers={[secondary]} />
        </HStack>
      }
    >
      {choices.map((task) => (
        <Button
          key={task.id}
          label={task.title}
          systemImage={selected.includes(task.id) ? 'checkmark' : undefined}
          onPress={() => onToggle(task.id)}
          modifiers={[menuActionDismissBehavior('disabled')]}
        />
      ))}
    </Menu>
  )
}


function FormShell({
  title,
  save,
  children,
}: {
  title: string
  save: { label: string; disabled: boolean; onPress: () => void }
  children: React.ReactNode
}) {
  const { theme, isDark } = useTheme()
  const router = useRouter()
  return (
    <>
      <Stack.Screen options={{ title }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Cancel" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="checkmark"
          variant="prominent"
          tintColor={theme.foreground as string}
          accessibilityLabel={save.label}
          disabled={save.disabled}
          onPress={save.onPress}
        />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>{children}</Form>
      </Host>
    </>
  )
}

function Loading({ title }: { title: string }) {
  const { theme } = useTheme()
  return (
    <>
      <Stack.Screen options={{ title }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.muted as string} />
      </View>
    </>
  )
}

/** `/work/new` — the new task form sheet. */
export function NewTaskScreen() {
  const params = useLocalSearchParams<{ scope?: string; title?: string; assignee?: string }>()
  const scope = params.scope === 'personal' ? 'personal' : 'workspace'
  const { activeWorkspaceId: workspaceId } = useWorkspace()
  const data = useWork(workspaceId, scope)
  if (!data.context || !data.items) return <Loading title="New task" />
  return (
    <NewTaskForm
      key={workspaceId ?? ''}
      workspaceId={workspaceId}
      scope={scope}
      people={availableWorkPeople(data.context.people, scope, data.context.principalId)}
      items={data.items}
      initialTitle={params.title ?? ''}
      initialAssignee={params.assignee ?? ''}
    />
  )
}

function NewTaskForm({
  workspaceId,
  scope,
  people,
  items,
  initialTitle,
  initialAssignee,
}: {
  workspaceId: string | null
  scope: 'personal' | 'workspace'
  people: WorkPerson[]
  items: WorkItem[]
  initialTitle: string
  initialAssignee: string
}) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<'todo' | 'backlog'>('todo')
  const [priority, setPriority] = useState<1 | 2 | 3>(2)
  const [assignee, setAssignee] = useState(initialAssignee)
  const [dates, setDates] = useState<{ startDate: string | null; dueDate: string | null }>({ startDate: null, dueDate: null })
  const [blockedBy, setBlockedBy] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const agent = people.find((person) => person.principalId === assignee)?.type === 'agent'
  const choices = dependencyChoices(items)

  async function create() {
    if (busy) return
    setError(null)
    try {
      const input = workRequest(`${title}\n${description}`, {
        scope,
        status,
        priority,
        blockedBy,
        ...(assignee ? { assigneePrincipalId: assignee } : {}),
        ...(dates.startDate ? { startDate: dates.startDate } : {}),
        ...(dates.dueDate ? { dueDate: dates.dueDate } : {}),
      })
      if (!workspaceId) throw new Error('Choose a workspace to continue.')
      setBusy(true)
      const item = await createWork(workspaceId, input)
      if (getRequestWorkspaceId() !== workspaceId) return
      router.back()
      router.push(`/work/${item.id}` as never)
    } catch (reason) {
      setError(workError(reason, 'Unable to create this task.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormShell title="New task" save={{ label: 'Create task', disabled: busy || !title.trim(), onPress: () => void create() }}>
      <Section footer={error ? <Text>{error}</Text> : undefined}>
        <TextField placeholder="What needs to be done?" defaultValue={initialTitle} autoFocus onValueChange={setTitle} />
        <TextField
          placeholder="Describe a good result"
          axis="vertical"
          onValueChange={setDescription}
          modifiers={[lineLimit({ min: 3, max: 8 })]}
        />
      </Section>
      <Section
        footer={agent ? <Text>{blockedBy.length ? 'The agent starts when dependencies finish.' : 'Assigning an agent starts work.'}</Text> : undefined}
      >
        <WorkAssigneePicker people={people} value={assignee} onChange={setAssignee} />
        <Picker label="Status" selection={status} onSelectionChange={(value: 'todo' | 'backlog') => setStatus(value)} modifiers={[pickerStyle('menu')]}>
          <Text modifiers={[tag('todo')]}>To do</Text>
          <Text modifiers={[tag('backlog')]}>Backlog</Text>
        </Picker>
        <Picker label="Priority" selection={priority} onSelectionChange={(value: number) => setPriority(value as 1 | 2 | 3)} modifiers={[pickerStyle('menu')]}>
          <Text modifiers={[tag(3)]}>High</Text>
          <Text modifiers={[tag(2)]}>Medium</Text>
          <Text modifiers={[tag(1)]}>Low</Text>
        </Picker>
      </Section>
      <Section title="Schedule">
        <WorkDateRows start={dates.startDate} due={dates.dueDate} onChange={setDates} />
      </Section>
      {choices.length ? (
        <Section>
          <WorkDependsOnMenu
            choices={choices}
            selected={blockedBy}
            onToggle={(id) => {
              const next = toggleDependency(blockedBy, id)
              if (next) setBlockedBy(next)
              else setError('A task can depend on up to 50 others.')
            }}
          />
        </Section>
      ) : null}
    </FormShell>
  )
}

/** `/work/schedule?id=…` — dates for a task, opened from the timeline. */
export function ScheduleTaskScreen() {
  const params = useLocalSearchParams<{ id?: string; scope?: string }>()
  const scope = params.scope === 'personal' ? 'personal' : 'workspace'
  const { activeWorkspaceId: workspaceId } = useWorkspace()
  const data = useWork(workspaceId, scope, params.id)
  if (!data.item || !workspaceId) return <Loading title="Schedule" />
  return <ScheduleForm key={data.item.id} workspaceId={workspaceId} item={data.item} />
}

function ScheduleForm({ workspaceId, item }: { workspaceId: string; item: WorkItem }) {
  const router = useRouter()
  const [dates, setDates] = useState({ startDate: item.startDate ?? null, dueDate: item.dueDate ?? null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const invalid = validateWorkDates(dates.startDate, dates.dueDate)
  const span = invalid ? null : taskSpan(dates.startDate, dates.dueDate)
  const shift = (days: number) => {
    if (!span) return
    const next = applyDrag(span, 'move', days)
    setDates({ startDate: next.start, dueDate: next.end })
  }
  async function save() {
    if (busy || invalid) return
    setBusy(true)
    setError(null)
    try {
      await updateWork(workspaceId, item.id, { ...dates, expectedUpdatedAt: item.updatedAt })
      router.back()
    } catch (reason) {
      setError(workError(reason, 'Unable to save these dates.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormShell title="Schedule" save={{ label: 'Save dates', disabled: busy || Boolean(invalid), onPress: () => void save() }}>
      <Section title={item.title} footer={invalid || error ? <Text>{invalid ?? error}</Text> : undefined}>
        <WorkDateRows start={dates.startDate} due={dates.dueDate} onChange={setDates} />
      </Section>
      {span ? (
        <Section>
          <Button onPress={() => shift(-1)}>
            <HStack spacing={12}>
              <Symbol systemName="arrow.left" size={17} />
              <Text>Move a day earlier</Text>
              <Spacer />
            </HStack>
          </Button>
          <Button onPress={() => shift(1)}>
            <HStack spacing={12}>
              <Symbol systemName="arrow.right" size={17} />
              <Text>Move a day later</Text>
              <Spacer />
            </HStack>
          </Button>
        </Section>
      ) : null}
    </FormShell>
  )
}

/**
 * Touch and hold a task row or board card for the system context menu:
 * move it to another column, to the top or bottom of its own, or schedule it.
 * With `swipe`, a list row also swipes right for Done (Reopen once done) and
 * left for Schedule; a full swipe runs the action.
 */
export function WorkTaskMenu({
  item,
  items,
  width,
  children,
  onMove,
  onSchedule,
  swipe = false,
}: {
  item: WorkItem
  items: readonly WorkItem[]
  width: number
  children: React.ReactNode
  /** List rows: swipe right to mark done (or reopen), swipe left to schedule. */
  swipe?: boolean
  onMove: (move: Omit<MoveWorkItemRequest, 'id'>) => void
  onSchedule: () => void
}) {
  const { isDark } = useTheme()
  const column = (status: WorkStatus) => sortByRank(items.filter((task) => task.id !== item.id && task.status === status))
  const end = (status: WorkStatus) => onMove({ status, afterId: column(status).at(-1)?.id ?? null, beforeId: null })
  const top = (status: WorkStatus) => onMove({ status, afterId: null, beforeId: column(status)[0]?.id ?? null })
  return (
    <Host matchContents={{ vertical: true }} style={{ width }} colorScheme={isDark ? 'dark' : 'light'}>
      <ContextMenu>
        <ContextMenu.Items>
          <Menu label="Move to" systemImage="arrow.right.circle">
            {WORK_STATUSES.filter((status) => status !== item.status).map((status) => (
              <Button key={status} label={WORK_STATUS_LABELS[status]} onPress={() => end(status)} />
            ))}
          </Menu>
          <Button label="Move to top" systemImage="arrow.up.to.line" onPress={() => top(item.status)} />
          <Button label="Move to bottom" systemImage="arrow.down.to.line" onPress={() => end(item.status)} />
          <Button label="Schedule" systemImage="calendar" onPress={onSchedule} />
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <RNHostView matchContents>
            <View style={{ width }}>
              {swipe ? (
                <SwipeRow
                  leading={[
                    item.status === 'done'
                      ? { label: 'Reopen', icon: 'arrow.uturn.backward', onPress: () => end('todo') }
                      : { label: 'Done', icon: 'checkmark', onPress: () => end('done') },
                  ]}
                  trailing={[{ label: 'Schedule', icon: 'calendar', onPress: onSchedule }]}
                >
                  {children}
                </SwipeRow>
              ) : (
                children
              )}
            </View>
          </RNHostView>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  )
}
