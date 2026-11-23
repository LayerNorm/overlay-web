import React, { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { Stack } from 'expo-router'
import { HeaderHeightContext } from '@react-navigation/elements'
import {
  Button,
  Form,
  HStack,
  Host,
  Image as SwiftSymbol,
  LabeledContent,
  Section,
  Spacer,
  Text as SwiftText,
  TextField,
  VStack,
  type TextFieldRef,
} from '@expo/ui/swift-ui'
import {
  disabled as swiftDisabled,
  font as swiftFont,
  foregroundStyle,
  frame as swiftFrame,
  lineLimit,
  scrollDismissesKeyboard,
  submitLabel,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import Svg, { Circle, Path } from 'react-native-svg'
import {
  Plus,
} from 'lucide-react-native'
import type {
  MoveWorkItemRequest,
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
  toggleDependency,
  toWorkDate,
  WORK_STATUS_LABELS,
  type WorkFilter,
} from '../../lib/work'
import { columnsByStatus } from '../../../src/shared/work/query'
import { IconButton, T } from '../shell/primitives'
import { AgentAvatar } from '../shell/AgentAvatar'
import { CreatureEmpty } from '../creatures/CreatureEmpty'
import { NativeSegmented } from '../navigation/NativeSegmented'
import { WorkTimeline } from './WorkTimeline'
import { useTheme } from '../../hooks/useTheme'
import { validateWorkDates } from '../../../src/shared/work/status'
import {
  secondary,
  WorkAssigneePicker,
  WorkDateRows,
  WorkDependsOnMenu,
  WorkTaskMenu,
  WorkStatusPicker,
} from './WorkForms'

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

function Tabs({
  values,
  value,
  onChange,
}: {
  values: string[]
  value: string
  onChange: (value: string) => void
  theme?: Theme
}) {
  return <NativeSegmented value={value} onChange={onChange} options={values.map((label) => ({ label, value: label }))} />
}

export const workLayouts = ['List', 'Board', 'Timeline'] as const
export type WorkLayout = (typeof workLayouts)[number]

export function WorkListView({
  items,
  context,
  userId,
  theme,
  dark,
  onOpen,
  onCreate,
  canEdit,
  onMove,
  onSchedule,
  canCreate = true,
  filter: initialFilter = 'needs-you',
  layout: nativeLayout,
}: {
  items: WorkItem[]
  context: WorkContext
  userId: string
  theme: Theme
  dark: boolean
  onOpen: (id: string) => void
  onCreate: () => void
  canEdit: (item: WorkItem) => boolean
  onMove: (item: WorkItem, move: Omit<MoveWorkItemRequest, 'id'>) => void
  onSchedule: (item: WorkItem) => void
  canCreate?: boolean
  filter?: WorkFilter
  /** Set when the screen owns the native navigation bar (title, create, layout menu). */
  layout?: WorkLayout
}) {
  const { width } = useWindowDimensions()
  const [filter, setFilter] = useState<WorkFilter>(initialFilter)
  const [inlineLayout, setLayout] = useState<WorkLayout>('List')
  const layout = nativeLayout ?? inlineLayout
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
  const headerHeight = React.use(HeaderHeightContext) ?? 0
  const statusGroups =
    layout === 'Timeline'
      ? null
      : groups.map((group) => (
          <View
            key={group.status}
            style={
              layout === 'Board'
                ? {
                    width: 256,
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    backgroundColor: theme.surfaceMuted,
                    paddingBottom: 8,
                  }
                : undefined
            }
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
            {group.items.map((item) => {
              const card = (
              <View
                key={item.id}
                style={
                  layout === 'Board'
                    ? {
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: theme.surfaceSubtle,
                        borderRadius: 8,
                        marginHorizontal: 8,
                        marginBottom: 6,
                      }
                    : undefined
                }
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.title}
                  onPress={() => onOpen(item.id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    gap: 12,
                    paddingHorizontal: 18,
                    paddingVertical: 14,
                    alignItems: 'center',
                    backgroundColor: pressed ? theme.surfaceSubtle : 'transparent',
                    ...(layout === 'Board' ? { flex: 1, paddingHorizontal: 10 } : {}),
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
              </View>
              )
              return canEdit(item) ? (
                <WorkTaskMenu
                  key={item.id}
                  item={item}
                  items={items}
                  width={layout === 'Board' ? 254 : width}
                  onMove={(move) => onMove(item, move)}
                  onSchedule={() => onSchedule(item)}
                >
                  {card}
                </WorkTaskMenu>
              ) : card
            })}
          </View>
        ))
  // With nothing to list there is nothing to scroll, so the empty page is a
  // plain view below the navigation bar. Inside an automatically inset
  // ScrollView, a sheet presented over Work (the account sheet) could leave the
  // native top inset at the sheet's height, stranding the filter mid-screen
  // and the empty-state creature behind the tab bar.
  const empty = nativeLayout && layout !== 'Timeline' && !visibleItems.length
  const Container = empty ? View : ScrollView
  const containerProps = empty
    ? { style: { flex: 1, paddingTop: headerHeight } }
    : { contentInsetAdjustmentBehavior: 'automatic' as const, contentContainerStyle: { flexGrow: 1, paddingBottom: 24 } }
  return (
    <Container {...containerProps}>
      {nativeLayout ? (
        <View style={{ paddingTop: 4, paddingBottom: 4, paddingHorizontal: 16 }}>
          <NativeSegmented
            value={filter}
            onChange={setFilter}
            options={[
              { label: 'Needs you', value: 'needs-you' },
              { label: 'Mine', value: 'mine' },
              { label: 'Everything', value: 'all' },
            ]}
          />
        </View>
      ) : (
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
      )}
      {layout === 'Board' ? (
        <ScrollView
          horizontal
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10, alignItems: 'flex-start' }}
        >
          {statusGroups}
        </ScrollView>
      ) : layout === 'Timeline' ? (
        <WorkTimeline
          items={visibleItems}
          today={today}
          theme={theme}
          onOpen={onOpen}
          canEdit={canEdit}
          onSchedule={onSchedule}
        />
      ) : (
        statusGroups
      )}
      {layout !== 'Timeline' && !visibleItems.length ? (
        <CreatureEmpty
          title={filter === 'needs-you' ? 'Nothing needs you' : 'No tasks yet'}
          detail={
            filter === 'needs-you'
              ? 'When an agent needs a decision or review, it shows up here.'
              : 'Hand a task to an agent and track it here.'
          }
          action={canCreate ? 'New task' : undefined}
          onAction={onCreate}
        />
      ) : null}
      {items.length >= 2000 ? (
        <T style={{ padding: 18, color: theme.muted, fontSize: 12 }}>
          Showing the first 2,000 tasks in this scope.
        </T>
      ) : null}
    </Container>
  )
}

/**
 * A title or description being edited in place. It focuses itself (autoFocus
 * is unreliable for a row just inserted into a Form) and commits its own text
 * when it loses focus or on Done.
 */
function InlineEditor({
  initial,
  title,
  field,
  onCommit,
}: {
  initial: string
  title: boolean
  field: React.RefObject<TextFieldRef | null>
  onCommit: (value: string) => void
}) {
  const value = useRef(initial)
  useEffect(() => {
    const timer = setTimeout(() => void field.current?.focus(), 80)
    return () => clearTimeout(timer)
  }, [field])
  const done = () => onCommit(value.current)
  return (
    <TextField
      ref={field}
      placeholder={title ? 'Title' : 'Describe what a good result looks like.'}
      defaultValue={initial}
      // A one-line title ends editing on Return, which commits via focus loss.
      axis={title ? 'horizontal' : 'vertical'}
      onValueChange={(next) => { value.current = next }}
      onFocusChange={(focused) => { if (!focused) done() }}
      modifiers={title ? [swiftFont({ size: 22, weight: 'semibold' }), submitLabel('done')] : [lineLimit({ min: 3, max: 14 })]}
    />
  )
}

export function WorkDetailView({
  item,
  items,
  context,
  events,
  thread,
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
  theme?: Theme
  dark?: boolean
  onThread: (id: string) => void
  onPatch: (patch: UpdateWorkItemRequest) => Promise<boolean>
  onStatus: (status: WorkStatus) => Promise<boolean>
  onComment: (body: string) => Promise<boolean>
  busy: boolean
  error?: string | null
  editable?: boolean
}) {
  const { theme, isDark } = useTheme()
  const [editing, setEditing] = useState<'title' | 'description' | null>(null)
  const [comment, setComment] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  const commentField = useRef<TextFieldRef>(null)
  const editorField = useRef<TextFieldRef>(null)
  const now = useWorkClock()
  const people = indexPeople(context.people)
  const activityPeople = { ...people, viewerPrincipalId: context.principalId }
  const locked = !editable || busy
  const message = validation ?? error
  function start(field: 'title' | 'description') {
    if (locked) return
    setValidation(null)
    setEditing(field)
  }
  // Each field commits its own draft, so tapping from one field into the
  // other can't save one field's text into the other.
  function commit(field: 'title' | 'description', value: string) {
    setEditing((current) => (current === field ? null : current))
    if (field === 'title') {
      const title = value.trim()
      if (!title) return setValidation('Give the task a title.')
      if (title !== item.title) void onPatch({ title })
    } else if (value !== (item.description ?? '')) {
      void onPatch({ description: value || null })
    }
  }
  const editableField = (field: 'title' | 'description') =>
    editing === field ? (
      <InlineEditor
        key={field}
        initial={field === 'title' ? item.title : (item.description ?? '')}
        title={field === 'title'}
        field={editorField}
        onCommit={(value) => commit(field, value)}
      />
    ) : field === 'title' ? (
      <Button onPress={() => start('title')}>
        <SwiftText modifiers={[swiftFont({ size: 22, weight: 'semibold' }), foregroundStyle(theme.foreground as string)]}>{item.title}</SwiftText>
      </Button>
    ) : (
      <Button onPress={() => start('description')}>
        <SwiftText markdownEnabled modifiers={item.description ? [foregroundStyle(theme.foreground as string)] : [secondary]}>
          {item.description || (editable ? 'Describe what a good result looks like.' : 'No description.')}
        </SwiftText>
      </Button>
    )
  const blockedTitles = item.blockedBy.map((id) => items.find((task) => task.id === id)?.title ?? 'Another task')
  return (
    <>
      {editing ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="checkmark"
            variant="prominent"
            tintColor={theme.foreground as string}
            accessibilityLabel="Done"
            onPress={() => void editorField.current?.blur()}
          />
        </Stack.Toolbar>
      ) : null}
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string), scrollDismissesKeyboard('interactively')]}>
          <Section>
            {editableField('title')}
            {editableField('description')}
          </Section>
          <Section footer={message ? <SwiftText>{message}</SwiftText> : undefined}>
            {editable ? (
              <>
                <WorkStatusPicker value={item.status} onChange={(status) => { if (!busy) void onStatus(status) }} />
                <WorkAssigneePicker
                  people={availableWorkPeople(context.people, item.scope, context.principalId)}
                  value={item.assigneePrincipalId ?? ''}
                  onChange={(id) => { if (!busy) void onPatch({ assigneePrincipalId: id || null }) }}
                />
                <WorkDateRows
                  start={item.startDate ?? null}
                  due={item.dueDate ?? null}
                  onChange={(dates) => {
                    const invalid = validateWorkDates(dates.startDate, dates.dueDate)
                    setValidation(invalid)
                    if (!invalid && !busy) void onPatch(dates)
                  }}
                />
                <WorkDependsOnMenu
                  choices={dependencyChoices(items, item.id)}
                  selected={item.blockedBy}
                  onToggle={(id) => {
                    const next = toggleDependency(item.blockedBy, id)
                    if (!next) return setValidation('A task can depend on up to 50 others.')
                    setValidation(null)
                    if (!busy) void onPatch({ blockedBy: next })
                  }}
                />
              </>
            ) : (
              <>
                <LabeledContent label="Status"><SwiftText>{WORK_STATUS_LABELS[item.status]}</SwiftText></LabeledContent>
                <LabeledContent label="Assignee">
                  <SwiftText>{people.byPrincipal.get(item.assigneePrincipalId ?? '')?.displayName ?? 'Unassigned'}</SwiftText>
                </LabeledContent>
                <LabeledContent label="Starts">
                  <SwiftText>{item.startDate ? formatWorkDate(item.startDate, toWorkDate(new Date(now))) : 'No date'}</SwiftText>
                </LabeledContent>
                <LabeledContent label="Due">
                  <SwiftText>{item.dueDate ? formatWorkDate(item.dueDate, toWorkDate(new Date(now))) : 'No date'}</SwiftText>
                </LabeledContent>
                <LabeledContent label="Depends on"><SwiftText>{blockedTitles.join(', ') || 'Nothing'}</SwiftText></LabeledContent>
              </>
            )}
          </Section>
          {(editable && item.status !== 'done') || thread?.visible ? (
            <Section
              footer={
                thread && !thread.visible ? <SwiftText>In the assigner’s thread.</SwiftText>
                : item.assignmentExecution?.status === 'failed' ? <SwiftText>Agent assignment failed. Reassign to try again.</SwiftText>
                : undefined
              }
            >
              {editable && item.status !== 'done' ? (
                <Button onPress={() => { if (!busy) void onStatus('done') }}>
                  <HStack spacing={12}>
                    <SwiftSymbol systemName="checkmark.circle" size={17} modifiers={[swiftFrame({ width: 26 })]} />
                    <SwiftText>Mark done</SwiftText>
                    <Spacer />
                  </HStack>
                </Button>
              ) : null}
              {thread?.visible ? (
                <Button onPress={() => onThread(thread.conversationId)}>
                  <HStack spacing={12}>
                    <SwiftSymbol systemName="bubble.left.and.bubble.right" size={17} modifiers={[swiftFrame({ width: 26 })]} />
                    <SwiftText>View thread</SwiftText>
                    <Spacer />
                    <SwiftSymbol systemName="chevron.right" size={13} modifiers={[secondary]} />
                  </HStack>
                </Button>
              ) : null}
            </Section>
          ) : null}
          <Section title="Activity">
            {events === undefined ? (
              <SwiftText modifiers={[secondary]}>Loading…</SwiftText>
            ) : !events.length ? (
              <SwiftText modifiers={[secondary]}>No activity yet.</SwiftText>
            ) : (
              events.map((event) => (
                <VStack key={event.id} alignment="leading" spacing={3}>
                  <SwiftText>
                    {commentBody(event) ??
                      `${actorName(event, activityPeople)} ${describeEvent(event, activityPeople) ?? 'updated this'}.`}
                  </SwiftText>
                  <SwiftText modifiers={[secondary, swiftFont({ size: 13 })]}>{formatAgo(event.createdAt, now)}</SwiftText>
                </VStack>
              ))
            )}
          </Section>
          {editable ? (
            <Section>
              <HStack spacing={10}>
                <TextField
                  ref={commentField}
                  placeholder="Add a comment"
                  axis="vertical"
                  onValueChange={setComment}
                  modifiers={[lineLimit({ min: 1, max: 6 })]}
                />
                <Button
                  onPress={() => {
                    const body = comment.trim()
                    if (!body || busy) return
                    void onComment(body).then((ok) => {
                      if (!ok) return
                      setComment('')
                      void commentField.current?.setText('')
                    })
                  }}
                  modifiers={[swiftDisabled(!comment.trim() || busy)]}
                >
                  <SwiftSymbol systemName="arrow.up.circle.fill" size={26} />
                </Button>
              </HStack>
            </Section>
          ) : null}
        </Form>
      </Host>
    </>
  )
}
