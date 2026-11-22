import React, { useState } from 'react'
import { Modal, View } from 'react-native'
import { BatteryFull, Signal, Wifi } from 'lucide-react-native'
import type { WorkContext, WorkEvent, WorkItem } from '@overlay/app-core'
import { rankBetween } from '../../src/shared/work/rank'
import { WorkPlacementSheet, WorkScheduleSheet } from '../components/work/WorkTaskActions'
import { getTheme } from '../constants/theme'
import { toWorkDate } from '../lib/work'
import { T } from '../components/shell/primitives'
import { WorkHeader } from '../components/work/WorkHeader'
import { WorkComposer, WorkDetailView, WorkListView } from '../components/work/WorkViews'

const context: WorkContext = {
  principalId: 'divyansh',
  role: 'owner',
  canCreateInWorkspace: true,
  people: [
    {
      principalId: 'overlay',
      displayName: 'Overlay',
      type: 'agent',
      userId: null,
      isDefault: true,
      agentVisibility: 'workspace',
    },
    {
      principalId: 'scout',
      displayName: 'Scout',
      type: 'agent',
      userId: null,
      avatarShape: 'cloud',
      avatarColor: '#7d9c8c',
      agentVisibility: 'workspace',
    },
    {
      principalId: 'builder',
      displayName: 'Builder',
      type: 'agent',
      userId: null,
      avatarShape: 'squircle',
      avatarColor: '#a28cbd',
      agentVisibility: 'workspace',
    },
    { principalId: 'divyansh', displayName: 'Divyansh Lalwani', type: 'human', userId: 'viewer' },
  ],
}
const base: WorkItem = {
  id: 'pricing',
  workspaceId: 'layernorm',
  scope: 'workspace',
  createdBy: 'viewer',
  title: 'Review subscription pricing',
  description: 'Compare our plans with the market and recommend a simpler structure.',
  status: 'review',
  blocked: false,
  priority: 2,
  rank: 'A',
  assigneePrincipalId: 'overlay',
  reviewerUserId: null,
  startDate: '2026-10-16',
  dueDate: toWorkDate(new Date()),
  parentId: null,
  blockedBy: [],
  doneWhen: [],
  context: [],
  archivedAt: null,
  archivedFromScope: null,
  createdAt: Date.now() - 3600000,
  updatedAt: Date.now() - 480000,
}
const fixtures: WorkItem[] = [
  base,
  {
    ...base,
    id: 'launch',
    title: 'Confirm research scope',
    status: 'review',
    assigneePrincipalId: 'scout',
    blocked: true,
    rank: 'B',
    dueDate: null,
  },
  {
    ...base,
    id: 'onboarding',
    title: 'Test the onboarding flow',
    assigneePrincipalId: 'builder',
    status: 'progress',
    blocked: true,
    blockedBy: ['pricing'],
    rank: 'C',
  },
  {
    ...base,
    id: 'mobile',
    title: 'Research customer feedback',
    status: 'progress',
    assigneePrincipalId: 'scout',
    blocked: true,
    rank: 'D',
    dueDate: null,
  },
]
const events: WorkEvent[] = [
  {
    id: 'review',
    workItemId: 'pricing',
    actorPrincipalId: 'overlay',
    kind: 'status',
    data: { from: 'progress', to: 'review' },
    createdAt: Date.now() - 480000,
  },
  {
    id: 'assigned',
    workItemId: 'pricing',
    actorPrincipalId: 'divyansh',
    kind: 'assignee',
    data: { to: 'overlay' },
    createdAt: Date.now() - 3600000,
  },
]

export function WorkFixture({
  initialScreen = 'work-list',
  dark = false,
  error = false,
  onAction = () => undefined,
}: {
  initialScreen?: string
  dark?: boolean
  error?: boolean
  animate?: boolean
  onAction?: (name: string) => void
}) {
  const theme = getTheme(dark)
  const [screen, setScreen] = useState(initialScreen)
  const [editor, setEditor] = useState<{ type: 'move' | 'schedule'; item: WorkItem } | null>(null)
  const [items, setItems] = useState(fixtures)
  const [id, setId] = useState('pricing')
  const [activity, setActivity] = useState(events)
  const [failure, setFailure] = useState<string | null>(null)
  function refused() {
    if (error) {
      setFailure('Unable to save. Please try again.')
      return true
    }
    setFailure(null)
    return false
  }
  const current = items.find((item) => item.id === id) ?? items[0]
  const save = async (patch: Partial<WorkItem>) => {
    if (refused()) return false
    setItems((values) => values.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    onAction('updated:' + Object.keys(patch).join(','))
    return true
  }
  return (
    <View style={{ width: 390, height: 844, backgroundColor: theme.surfaceElevated }}>
      <View
        style={{
          height: 52,
          paddingTop: 14,
          paddingHorizontal: 27,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <T style={{ color: theme.foreground }}>9:41</T>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Signal size={15} color={theme.foreground} />
          <Wifi size={15} color={theme.foreground} />
          <BatteryFull size={21} color={theme.foreground} />
        </View>
      </View>
      <WorkHeader
        theme={theme}
        scope="workspace"
        title={screen === 'task-detail' ? current.title : undefined}
        onMenu={() => onAction('sidebar')}
        onScope={() => onAction('scope')}
        onSearch={() => onAction('search')}
        onBack={screen === 'task-detail' ? () => setScreen('work-list') : undefined}
      />
      <View style={{ flex: 1 }}>
        {screen === 'task-detail' ? (
          <WorkDetailView
            item={current}
            items={items}
            context={context}
            events={activity.filter((event) => event.workItemId === id)}
            thread={{
              visible: true,
              conversationId: 'pricing-thread',
              agentId: 'overlay',
              title: 'Review subscription pricing',
              state: 'finished',
              updatedAt: current.updatedAt,
            }}
            theme={theme}
            dark={dark}
            onThread={(threadId) => onAction('thread:' + threadId)}
            onPatch={save}
            onStatus={(status) => save({ status })}
            onComment={async (body) => {
              if (refused()) return false
              setActivity((values) => [
                ...values,
                {
                  id: String(Date.now()),
                  workItemId: id,
                  actorPrincipalId: 'divyansh',
                  kind: 'comment',
                  data: { body },
                  createdAt: Date.now(),
                },
              ])
              onAction('comment:' + body)
              return true
            }}
            busy={false}
            error={failure}
          />
        ) : (
          <WorkListView
            items={items}
            context={context}
            userId="viewer"
            theme={theme}
            dark={dark}
            onOpen={(taskId) => {
              setId(taskId)
              setScreen('task-detail')
            }}
            onCreate={() => setScreen('new-task')}
            canEdit={() => true}
            onMove={(item) => setEditor({ type: 'move', item })}
            onSchedule={(item) => setEditor({ type: 'schedule', item })}
          />
        )}
      </View>
      <View
        style={{ height: 34, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 7 }}
      >
        <View
          style={{ width: 134, height: 5, borderRadius: 4, backgroundColor: theme.foreground }}
        />
      </View>
      {editor ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setEditor(null)}>
          {editor.type === 'move' ? (
            <WorkPlacementSheet
              item={editor.item}
              items={items}
              theme={theme}
              busy={false}
              error={failure}
              onClose={() => setEditor(null)}
              onMove={({ status, beforeId, afterId }) => {
                if (refused()) return
                const before = items.find((task) => task.id === beforeId)
                const after = items.find((task) => task.id === afterId)
                const rank = rankBetween(after?.rank ?? null, before?.rank ?? null)
                setItems((values) =>
                  values.map((task) =>
                    task.id === editor.item.id
                      ? { ...task, status: status ?? task.status, rank }
                      : task,
                  ),
                )
                setEditor(null)
              }}
            />
          ) : (
            <WorkScheduleSheet
              item={editor.item}
              theme={theme}
              busy={false}
              error={failure}
              onClose={() => setEditor(null)}
              onSave={(dates) => {
                if (refused()) return
                setItems((values) =>
                  values.map((task) => (task.id === editor.item.id ? { ...task, ...dates } : task)),
                )
                setEditor(null)
              }}
            />
          )}
        </Modal>
      ) : null}
      {screen === 'new-task' ? (
        <View style={{ position: 'absolute', inset: 0 }}>
          <WorkComposer
            theme={theme}
            dark={dark}
            context={context}
            items={items}
            scope="workspace"
            initialTitle="Draft the mobile launch checklist"
            initialAssignee="overlay"
            bottomInset={10}
            onClose={() => setScreen('work-list')}
            busy={false}
            error={failure}
            onCreate={async (input) => {
              if (refused()) return false
              const item: WorkItem = {
                ...base,
                ...input,
                id: 'created',
                description: input.description ?? null,
                status: input.status ?? 'todo',
                assigneePrincipalId: input.assigneePrincipalId ?? null,
              }
              setItems((values) => [...values, item])
              setId(item.id)
              setScreen('task-detail')
              onAction('created:' + input.title)
              return true
            }}
          />
        </View>
      ) : null}
    </View>
  )
}
