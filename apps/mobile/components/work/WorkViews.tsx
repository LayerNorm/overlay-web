import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import {
  ArrowUp,
  CalendarDays,
  Check,
  GitFork,
  MessageSquare,
  Plus,
  User,
  X,
} from 'lucide-react-native'
import type {
  CreateWorkItemRequest,
  UpdateWorkItemRequest,
  WorkContext,
  WorkEvent,
  WorkItem,
  WorkPerson,
  WorkStatus,
} from '@overlay/app-core'
import type { Theme } from '../../constants/theme'
import type { WorkThread } from '../../services/workService'
import {
  actorName,
  availableWorkPeople,
  commentBody,
  dependencyChoices,
  describeEvent,
  filterWork,
  formatAgo,
  formatWorkDate,
  groupByStatus,
  indexPeople,
  toWorkDate,
  workRequest,
  WORK_STATUSES,
  WORK_STATUS_LABELS,
  type WorkFilter,
} from '../../lib/work'
import { columnsByStatus } from '../../../src/shared/work/query'
import { Button, IconButton, T } from '../shell/primitives'
import { AgentAvatar } from '../shell/AgentAvatar'
import { WorkMarkdown } from './WorkMarkdown'
import { WorkTimeline } from './WorkTimeline'

function useWorkClock() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function WorkStatusIcon({ status, theme }: { status: WorkStatus; theme: Theme }) {
  const color =
    status === 'review'
      ? '#a68abf'
      : status === 'progress'
        ? '#bc944c'
        : status === 'done'
          ? '#6b9476'
          : theme.muted
  return (
    <Svg width={17} height={17} viewBox="0 0 16 16">
      <Circle
        cx={8}
        cy={8}
        r={status === 'done' ? 7 : 6}
        fill={status === 'done' ? color : 'none'}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={status === 'backlog' ? '2.2 2.2' : undefined}
      />
      {status === 'progress' ? <Path d="M8 4a4 4 0 0 1 0 8Z" fill={color} /> : null}
      {status === 'review' ? <Circle cx={8} cy={8} r={4} fill={color} /> : null}
      {status === 'done' ? (
        <Path
          d="m5 8.2 2 2 4-4.2"
          fill="none"
          stroke={theme.background}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </Svg>
  )
}

export function WorkAvatar({
  person,
  theme,
  dark,
}: {
  person?: WorkPerson | null
  theme: Theme
  dark: boolean
}) {
  if (person?.type === 'agent')
    return (
      <AgentAvatar
        agent={{ ...person, name: person.displayName }}
        dark={dark}
        foreground={theme.foreground}
        size={24}
      />
    )
  return (
    <View
      accessibilityLabel={person?.displayName ?? 'Unassigned'}
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.surfaceSubtle,
      }}
    >
      <T style={{ color: theme.muted, fontSize: 9 }}>
        {person
          ? person.displayName
              .trim()
              .split(/\s+/)
              .map((part) => part[0])
              .slice(0, 2)
              .join('')
          : ''}
      </T>
    </View>
  )
}

export function WorkField({ theme, style, ...props }: TextInputProps & { theme: Theme }) {
  return (
    <TextInput
      {...props}
      placeholderTextColor={theme.muted}
      style={[
        {
          fontFamily: 'Geist',
          fontSize: 14,
          color: theme.foreground,
          backgroundColor: theme.surfaceMuted,
          borderRadius: 8,
          padding: 12,
          minHeight: 42,
          includeFontPadding: false,
        },
        style,
      ]}
    />
  )
}

function Tabs({
  values,
  value,
  onChange,
  theme,
}: {
  values: string[]
  value: string
  onChange: (value: string) => void
  theme: Theme
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 5 }}>
      {values.map((label) => (
        <Pressable
          key={label}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === label }}
          onPress={() => onChange(label)}
          style={{
            paddingHorizontal: 11,
            paddingVertical: 9,
            borderRadius: 7,
            backgroundColor: value === label ? theme.surfaceSubtle : 'transparent',
          }}
        >
          <T style={{ color: value === label ? theme.foreground : theme.muted, fontSize: 12 }}>
            {label}
          </T>
        </Pressable>
      ))}
    </View>
  )
}

const workLayouts = ['List', 'Board', 'Timeline'] as const
type WorkLayout = (typeof workLayouts)[number]

export function WorkListView({
  items,
  context,
  userId,
  theme,
  dark,
  onOpen,
  onCreate,
  canCreate = true,
  filter: initialFilter = 'needs-you',
}: {
  items: WorkItem[]
  context: WorkContext
  userId: string
  theme: Theme
  dark: boolean
  onOpen: (id: string) => void
  onCreate: () => void
  canCreate?: boolean
  filter?: WorkFilter
}) {
  const [filter, setFilter] = useState<WorkFilter>(initialFilter)
  const [layout, setLayout] = useState<WorkLayout>('List')
  const labels: Record<WorkFilter, string> = {
    'needs-you': 'Needs you',
    mine: 'Assigned to me',
    all: 'Everything',
  }
  const visibleItems = filterWork(items, {
    filter,
    query: '',
    viewer: { userId, principalId: context.principalId },
  })
  const groups = layout === 'Board' ? columnsByStatus(visibleItems) : groupByStatus(visibleItems)
  const people = new Map(context.people.map((person) => [person.principalId, person]))
  const today = toWorkDate(new Date(useWorkClock()))
  const statusGroups = layout === 'Timeline' ? null : groups.map((group) => (
    <View
      key={group.status}
      style={layout === 'Board' ? {
        width: 256,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 10,
        backgroundColor: theme.surfaceMuted,
        paddingBottom: 8,
      } : undefined}
    >
      <T
        style={{
          paddingHorizontal: 18,
          paddingTop: 20,
          paddingBottom: 8,
          fontSize: 12,
          color: theme.muted,
        }}
      >
        {group.status === 'review' ? 'Ready for review' : WORK_STATUS_LABELS[group.status]} ·{' '}
        {group.items.length}
      </T>
      {group.items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={item.title}
          onPress={() => onOpen(item.id)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            gap: 12,
            paddingHorizontal: 18,
            paddingVertical: 14,
            alignItems: 'center',
            backgroundColor: pressed || layout === 'Board' ? theme.surfaceSubtle : 'transparent',
            ...(layout === 'Board' ? { borderRadius: 8, marginHorizontal: 8, marginBottom: 6 } : {}),
          })}
        >
          <WorkStatusIcon status={item.status} theme={theme} />
          <View style={{ flex: 1 }}>
            <T
              numberOfLines={1}
              style={{
                color: item.status === 'done' ? theme.muted : theme.foreground,
                fontSize: 14,
                textDecorationLine: item.status === 'done' ? 'line-through' : 'none',
              }}
            >
              {item.title}
            </T>
            {item.dueDate || item.blocked ? (
              <T style={{ color: theme.muted, fontSize: 11, marginTop: 5 }}>
                {item.blocked
                  ? 'Blocked'
                  : item.dueDate === today
                    ? 'Today'
                    : formatWorkDate(item.dueDate!, today)}
              </T>
            ) : null}
          </View>
          <WorkAvatar
            person={people.get(item.assigneePrincipalId ?? '')}
            theme={theme}
            dark={dark}
          />
        </Pressable>
      ))}
    </View>
  ))
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 22,
          }}
        >
          <T style={{ fontSize: 24, fontWeight: '500', color: theme.foreground }}>Work</T>
          {canCreate ? (
            <IconButton icon={Plus} label="New task" onPress={onCreate} theme={theme} />
          ) : null}
        </View>
        <Tabs
          values={[...workLayouts]}
          value={layout}
          onChange={(label) => setLayout(workLayouts.find((entry) => entry === label) ?? 'List')}
          theme={theme}
        />
        <Tabs
          values={Object.values(labels)}
          value={labels[filter]}
          onChange={(label) =>
            setFilter((Object.keys(labels) as WorkFilter[]).find((key) => labels[key] === label)!)
          }
          theme={theme}
        />
      </View>
      {layout === 'Board' ? (
        <ScrollView
          horizontal
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10, alignItems: 'flex-start' }}
        >
          {statusGroups}
        </ScrollView>
      ) : layout === 'Timeline' ? (
        <WorkTimeline items={visibleItems} today={today} theme={theme} onOpen={onOpen} />
      ) : statusGroups}
      {layout !== 'Timeline' && !visibleItems.length ? (
        <T style={{ textAlign: 'center', color: theme.muted, padding: 48 }}>No tasks here.</T>
      ) : null}
      {items.length >= 2000 ? (
        <T style={{ padding: 18, color: theme.muted, fontSize: 12 }}>
          Showing the first 2,000 tasks in this scope.
        </T>
      ) : null}
    </ScrollView>
  )
}

export function WorkSheet({
  title,
  theme,
  onClose,
  children,
  bottomInset = 0,
  minHeight,
}: {
  title: string
  theme: Theme
  onClose: () => void
  children: React.ReactNode
  bottomInset?: number
  minHeight?: number
}) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.overlayScrim }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss sheet"
        onPress={onClose}
        style={{ flex: 1 }}
      />
      <View
        accessibilityViewIsModal
        style={{
          maxHeight: '92%',
          minHeight,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          paddingHorizontal: 22,
          paddingTop: 10,
          paddingBottom: 28 + bottomInset,
          backgroundColor: theme.surfaceElevated,
        }}
      >
        <View
          style={{
            width: 34,
            height: 4,
            borderRadius: 5,
            backgroundColor: theme.border,
            alignSelf: 'center',
            marginBottom: 15,
          }}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <T style={{ fontSize: 20, fontWeight: '500', color: theme.foreground }}>{title}</T>
          <IconButton icon={X} label="Close sheet" onPress={onClose} theme={theme} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
          {children}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}

export function WorkOptions({
  title,
  theme,
  choices,
  selected,
  onSelect,
  onClose,
  error,
  busy = false,
}: {
  title: string
  theme: Theme
  choices: Array<{ id: string; label: string }>
  selected: string[]
  onSelect: (id: string) => void
  onClose: () => void
  error?: string | null
  busy?: boolean
}) {
  const [query, search] = useState('')
  const filtered = choices.filter((choice) =>
    choice.label.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <WorkSheet title={title} theme={theme} onClose={onClose}>
      <WorkField
        theme={theme}
        accessibilityLabel="Search options"
        placeholder="Search..."
        value={query}
        onChangeText={search}
      />
      {error ? (
        <T accessibilityRole="alert" style={{ color: theme.foreground }}>
          {error}
        </T>
      ) : null}
      {filtered.map((choice) => (
        <Pressable
          key={choice.id}
          accessibilityRole="button"
          accessibilityState={{ selected: selected.includes(choice.id), disabled: busy }}
          disabled={busy}
          onPress={() => onSelect(choice.id)}
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}
        >
          <T style={{ flex: 1, fontSize: 14, color: theme.foreground }}>{choice.label}</T>
          {selected.includes(choice.id) ? <Check color={theme.foreground} size={16} /> : null}
        </Pressable>
      ))}
      {!filtered.length ? <T style={{ color: theme.muted }}>No matches.</T> : null}
    </WorkSheet>
  )
}

export function WorkComposer({
  theme,
  dark,
  context,
  items,
  scope,
  onClose,
  onCreate,
  busy,
  error,
  bottomInset = 0,
  initialTitle = '',
  initialAssignee = '',
}: {
  theme: Theme
  dark: boolean
  context: WorkContext
  items: WorkItem[]
  scope: 'personal' | 'workspace'
  onClose: () => void
  onCreate: (input: CreateWorkItemRequest) => Promise<boolean>
  busy: boolean
  error?: string | null
  bottomInset?: number
  initialTitle?: string
  initialAssignee?: string
}) {
  const [tab, setTab] = useState('Task')
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState(initialAssignee)
  const [startDate, setStart] = useState('')
  const [dueDate, setDue] = useState('')
  const [blockedBy, setDependencies] = useState<string[]>([])
  const [status, setStatus] = useState<'todo' | 'backlog'>('todo')
  const [priority, setPriority] = useState<1 | 2 | 3>(2)
  const [picker, setPicker] = useState<string | null>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const selected = context.people.find((person) => person.principalId === assignee)
  async function submit() {
    try {
      const input = workRequest(`${title}\n${description}`, {
        scope,
        status,
        priority,
        blockedBy,
        ...(assignee ? { assigneePrincipalId: assignee } : {}),
        ...(startDate ? { startDate } : {}),
        ...(dueDate ? { dueDate } : {}),
      })
      setValidation(null)
      await onCreate(input)
    } catch (reason) {
      setValidation(reason instanceof Error ? reason.message : 'Unable to create task.')
    }
  }
  return (
    <WorkSheet
      minHeight={454}
      title="New task"
      theme={theme}
      onClose={() => {
        if (!busy) onClose()
      }}
      bottomInset={bottomInset}
    >
      <Tabs values={['Task', 'Details']} value={tab} onChange={setTab} theme={theme} />
      <View style={{ backgroundColor: theme.surfaceMuted, borderRadius: 12, padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <IconButton
            label="Assignee"
            icon={User}
            theme={theme}
            onPress={() => setPicker('Assignee')}
          />
          <IconButton
            label="Schedule"
            icon={CalendarDays}
            theme={theme}
            onPress={() => setPicker('Schedule')}
          />
          <IconButton
            label="Depends on"
            icon={GitFork}
            theme={theme}
            onPress={() => setPicker('Depends on')}
          />
          <View style={{ flex: 1 }} />
          <T style={{ fontSize: 11, color: theme.muted, alignSelf: 'center' }}>
            {blockedBy.length ? `${blockedBy.length} dependencies` : ''}
          </T>
        </View>
        {tab === 'Task' ? (
          <WorkField
            theme={theme}
            accessibilityLabel="Task title"
            placeholder="What needs to be done?"
            multiline
            editable={!busy}
            value={title}
            onChangeText={setTitle}
            style={{ minHeight: 82, padding: 0, textAlignVertical: 'top' }}
          />
        ) : (
          <>
            <WorkField
              theme={theme}
              accessibilityLabel="Description"
              placeholder="Describe a good result"
              multiline
              editable={!busy}
              value={description}
              onChangeText={setDescription}
              style={{ minHeight: 100 }}
            />
            <Tabs
              values={['Todo', 'Backlog']}
              value={status === 'todo' ? 'Todo' : 'Backlog'}
              onChange={(value) => setStatus(value === 'Todo' ? 'todo' : 'backlog')}
              theme={theme}
            />
            <Tabs
              values={['Low', 'Medium', 'High']}
              value={['Low', 'Medium', 'High'][priority - 1]}
              onChange={(value) =>
                setPriority((['Low', 'Medium', 'High'].indexOf(value) + 1) as 1 | 2 | 3)
              }
              theme={theme}
            />
          </>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <WorkAvatar person={selected} theme={theme} dark={dark} />
          <T style={{ color: theme.muted, fontSize: 11, flex: 1 }}>
            {selected?.displayName ?? 'Unassigned'}
          </T>
          <Button
            theme={theme}
            secondary
            icon={ArrowUp}
            disabled={busy || !title.trim()}
            onPress={() => void submit()}
          >
            {busy ? 'Creating...' : 'Create task'}
          </Button>
        </View>
      </View>
      {startDate || dueDate ? (
        <T style={{ color: theme.muted, fontSize: 12 }}>
          {startDate ? `Starts ${startDate}` : ''}
          {dueDate ? `  Due ${dueDate}` : ''}
        </T>
      ) : null}
      {selected?.type === 'agent' ? (
        <T style={{ color: theme.muted, fontSize: 11 }}>
          {blockedBy.length
            ? 'Starts when dependencies finish.'
            : 'Assigning an agent starts work.'}
        </T>
      ) : null}
      {validation || error ? (
        <T accessibilityRole="alert" style={{ color: theme.foreground, fontSize: 12 }}>
          {validation ?? error}
        </T>
      ) : null}
      <Modal
        visible={picker !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setPicker(null)}
      >
        {picker === 'Schedule' ? (
          <WorkSheet title="Schedule" theme={theme} onClose={() => setPicker(null)}>
            <T style={{ color: theme.muted }}>Start</T>
            <WorkField
              theme={theme}
              accessibilityLabel="Start date"
              placeholder="YYYY-MM-DD"
              value={startDate}
              onChangeText={setStart}
              autoCapitalize="none"
            />
            <T style={{ color: theme.muted }}>Due</T>
            <WorkField
              theme={theme}
              accessibilityLabel="Due date"
              placeholder="YYYY-MM-DD"
              value={dueDate}
              onChangeText={setDue}
              autoCapitalize="none"
            />
            <Button theme={theme} secondary onPress={() => setPicker(null)}>
              Done
            </Button>
          </WorkSheet>
        ) : (
          <WorkOptions
            title={picker ?? ''}
            theme={theme}
            onClose={() => setPicker(null)}
            choices={
              picker === 'Assignee'
                ? [
                    { id: '', label: 'Unassigned' },
                    ...availableWorkPeople(context.people, scope, context.principalId).map(
                      (person) => ({ id: person.principalId, label: person.displayName }),
                    ),
                  ]
                : dependencyChoices(items).map((item) => ({ id: item.id, label: item.title }))
            }
            selected={picker === 'Assignee' ? [assignee] : blockedBy}
            onSelect={(id) => {
              if (picker === 'Assignee') {
                setAssignee(id)
                setPicker(null)
              } else
                setDependencies((values) =>
                  values.includes(id)
                    ? values.filter((value) => value !== id)
                    : values.length < 50
                      ? [...values, id]
                      : values,
                )
            }}
          />
        )}
      </Modal>
    </WorkSheet>
  )
}

export function WorkDetailView({
  item,
  items,
  context,
  events,
  thread,
  theme,
  dark,
  onThread,
  onPatch,
  onStatus,
  onComment,
  busy,
  error,
  editable = true,
}: {
  item: WorkItem
  items: WorkItem[]
  context: WorkContext
  events?: WorkEvent[]
  thread?: WorkThread
  theme: Theme
  dark: boolean
  onThread: (id: string) => void
  onPatch: (patch: UpdateWorkItemRequest) => Promise<boolean>
  onStatus: (status: WorkStatus) => Promise<boolean>
  onComment: (body: string) => Promise<boolean>
  busy: boolean
  error?: string | null
  editable?: boolean
}) {
  const [editor, setEditor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [comment, setComment] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  const people = indexPeople(context.people)
  const now = useWorkClock()
  const activityPeople = { ...people, viewerPrincipalId: context.principalId }
  const assignee = context.people.find((person) => person.principalId === item.assigneePrincipalId)
  function edit(field: string, value = '') {
    setDraft(value)
    setValidation(null)
    setEditor(field)
  }
  async function save(patch: UpdateWorkItemRequest) {
    if (await onPatch(patch)) setEditor(null)
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 18, paddingTop: 22, paddingBottom: 30, gap: 18 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change status"
        disabled={!editable || busy}
        onPress={() => edit('Status')}
        style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
      >
        <WorkStatusIcon status={item.status} theme={theme} />
        <T style={{ fontSize: 12, color: theme.muted }}>
          {item.status === 'review' ? 'Ready for review' : WORK_STATUS_LABELS[item.status]}
        </T>
      </Pressable>
      <Pressable
        disabled={!editable || busy}
        accessibilityRole="button"
        accessibilityLabel="Edit task title"
        onPress={() => edit('Title', item.title)}
      >
        <T style={{ fontSize: 24, fontWeight: '500', color: theme.foreground }}>{item.title}</T>
      </Pressable>
      <Pressable
        disabled={!editable || busy}
        accessibilityRole="button"
        accessibilityLabel="Edit description"
        onPress={() => edit('Description', item.description ?? '')}
        style={{ marginBottom: 8 }}
      >
        <WorkMarkdown
          theme={theme}
          text={item.description || 'Describe what a good result looks like.'}
        />
      </Pressable>
      <View>
        {[
          { name: 'Assignee', value: assignee?.displayName ?? 'Unassigned' },
          {
            name: 'Due',
            value: item.dueDate
              ? formatWorkDate(item.dueDate, toWorkDate(new Date(now)))
              : 'No date',
          },
          {
            name: 'Started',
            value: item.startDate ? formatWorkDate(item.startDate) : 'Not started',
          },
          {
            name: 'Blocked by',
            value:
              item.blockedBy
                .map((id) => items.find((task) => task.id === id)?.title ?? 'Another task')
                .join(', ') || 'Nothing',
          },
        ].map((row) => (
          <Pressable
            key={row.name}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${row.name}`}
            disabled={!editable || busy}
            onPress={() =>
              edit(
                row.name,
                row.name === 'Due'
                  ? (item.dueDate ?? '')
                  : row.name === 'Started'
                    ? (item.startDate ?? '')
                    : '',
              )
            }
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 10 }}
          >
            <T style={{ color: theme.muted, fontSize: 13, width: 90 }}>{row.name}</T>
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                justifyContent: 'flex-end',
              }}
            >
              {row.name === 'Assignee' ? (
                <WorkAvatar person={assignee} theme={theme} dark={dark} />
              ) : null}
              <T numberOfLines={2} style={{ color: theme.foreground, fontSize: 13, flexShrink: 1 }}>
                {row.value}
              </T>
            </View>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {editable && item.status !== 'done' ? (
          <Button
            theme={theme}
            secondary
            disabled={busy}
            icon={Check}
            onPress={() => void onStatus('done')}
          >
            Mark done
          </Button>
        ) : null}
        {thread?.visible ? (
          <Button
            theme={theme}
            icon={MessageSquare}
            onPress={() => onThread(thread.conversationId)}
          >
            View thread
          </Button>
        ) : null}
      </View>
      {thread && !thread.visible ? (
        <T style={{ color: theme.muted, fontSize: 12 }}>In the assigner’s thread</T>
      ) : null}
      {item.assignmentExecution?.status === 'failed' ? (
        <T style={{ color: theme.muted }}>Agent assignment failed. Reassign to try again.</T>
      ) : null}
      <T style={{ color: theme.muted, fontSize: 12, marginTop: 10 }}>Activity</T>
      {events === undefined ? (
        <ActivityIndicator color={theme.muted} />
      ) : !events.length ? (
        <T style={{ color: theme.muted }}>No activity yet.</T>
      ) : (
        events.map((event) => (
          <View key={event.id} style={{ flexDirection: 'row', gap: 12, paddingVertical: 4 }}>
            <WorkAvatar
              person={context.people.find(
                (person) => person.principalId === event.actorPrincipalId,
              )}
              theme={theme}
              dark={dark}
            />
            <View style={{ flex: 1, gap: 5 }}>
              <T style={{ color: theme.foreground, fontSize: 13, lineHeight: 19 }}>
                {commentBody(event) ??
                  `${actorName(event, activityPeople)} ${describeEvent(event, activityPeople) ?? 'updated this'}.`}
              </T>
              <T style={{ color: theme.muted, fontSize: 11 }}>{formatAgo(event.createdAt, now)}</T>
            </View>
          </View>
        ))
      )}
      {editable ? (
        <View style={{ gap: 8 }}>
          <WorkField
            theme={theme}
            accessibilityLabel="Comment"
            placeholder="Add a comment..."
            value={comment}
            multiline
            maxLength={5000}
            editable={!busy}
            onChangeText={setComment}
          />
          <Button
            theme={theme}
            disabled={busy || !comment.trim()}
            onPress={() => {
              void onComment(comment).then((ok) => {
                if (ok) setComment('')
              })
            }}
          >
            Comment
          </Button>
        </View>
      ) : null}
      {error ? (
        <T accessibilityRole="alert" style={{ color: theme.foreground }}>
          {error}
        </T>
      ) : null}
      <Modal
        visible={editor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditor(null)}
      >
        {['Status', 'Assignee', 'Blocked by'].includes(editor ?? '') ? (
          <WorkOptions
            title={editor ?? ''}
            theme={theme}
            error={validation ?? error}
            busy={busy}
            onClose={() => setEditor(null)}
            selected={
              editor === 'Status'
                ? [item.status]
                : editor === 'Assignee'
                  ? [item.assigneePrincipalId ?? '']
                  : item.blockedBy
            }
            choices={
              editor === 'Status'
                ? WORK_STATUSES.map((id) => ({ id, label: WORK_STATUS_LABELS[id] }))
                : editor === 'Assignee'
                  ? [
                      { id: '', label: 'Unassigned' },
                      ...availableWorkPeople(context.people, item.scope, context.principalId).map(
                        (person) => ({ id: person.principalId, label: person.displayName }),
                      ),
                    ]
                  : dependencyChoices(items, item.id).map((task) => ({
                      id: task.id,
                      label: task.title,
                    }))
            }
            onSelect={(id) => {
              if (busy) return
              if (editor === 'Status')
                void onStatus(id as WorkStatus).then((ok) => {
                  if (ok) setEditor(null)
                })
              else if (editor === 'Assignee') void save({ assigneePrincipalId: id || null })
              else {
                const next = item.blockedBy.includes(id)
                  ? item.blockedBy.filter((value) => value !== id)
                  : [...item.blockedBy, id]
                if (next.length > 50) {
                  setValidation('A task can depend on up to 50 others.')
                  return
                }
                setValidation(null)
                void onPatch({ blockedBy: next })
              }
            }}
          />
        ) : (
          <WorkSheet title={editor ?? ''} theme={theme} onClose={() => setEditor(null)}>
            <WorkField
              theme={theme}
              accessibilityLabel={editor ?? 'Value'}
              value={draft}
              onChangeText={setDraft}
              multiline={editor === 'Description'}
              placeholder={editor === 'Due' || editor === 'Started' ? 'YYYY-MM-DD' : ''}
              editable={!busy}
            />
            <Button
              theme={theme}
              secondary
              disabled={busy}
              onPress={() => {
                const patch: UpdateWorkItemRequest =
                  editor === 'Title'
                    ? { title: draft.trim() }
                    : editor === 'Description'
                      ? { description: draft || null }
                      : editor === 'Due'
                        ? { dueDate: draft || null }
                        : { startDate: draft || null }
                if (editor === 'Title' && !draft.trim()) {
                  setValidation('Give the task a title.')
                  return
                }
                void save(patch)
              }}
            >
              Save
            </Button>
            {validation || error ? (
              <T accessibilityRole="alert" style={{ color: theme.foreground }}>
                {validation ?? error}
              </T>
            ) : null}
          </WorkSheet>
        )}
      </Modal>
    </ScrollView>
  )
}
