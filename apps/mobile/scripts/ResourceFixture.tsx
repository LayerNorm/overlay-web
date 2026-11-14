import React, { useState } from 'react'
import { View } from 'react-native'
import { BatteryFull, Signal, Wifi } from 'lucide-react-native'
import type { AutomationRunSummary, AutomationSummary, KnowledgeFile } from '@overlay/app-core'
import type {
  WorkspaceNotification,
  WorkspaceNotificationFilter,
} from '@overlay/workspace-contracts'
import { getTheme } from '../constants/theme'
import { T } from '../components/shell/primitives'
import {
  ActivityFeed,
  AutomationDetail,
  AutomationList,
  FilePaper,
  FilesBrowser,
  NoteDocument,
  ResourcePage,
  ResourceState,
  SearchResults,
} from '../components/knowledge/ResourceViews'

const time = new Date(2026, 10, 11, 10, 32).getTime()
const noteText =
  'A focused plan for the mobile beta.\n\n### Before we invite anyone\n\nCheck the first conversation on a real phone. Keep the path from sign in to value short.\n\nTest sign in and workspace access\n\nReview push notification copy\n\nPrepare a short feedback form\n\n### Launch day\n\nInvite ten people. Be available. Watch where they hesitate.'
const base = { createdAt: time, updatedAt: time, parentId: null }
const files: KnowledgeFile[] = [
  { ...base, _id: 'launch', type: 'folder', kind: 'folder', name: 'Launch' },
  { ...base, _id: 'brand', type: 'folder', kind: 'folder', name: 'Brand' },
  {
    ...base,
    _id: 'note',
    type: 'note',
    kind: 'note',
    name: 'Launch checklist',
    textContent: noteText,
  },
  {
    ...base,
    _id: 'brief',
    type: 'file',
    kind: 'upload',
    name: 'Pricing research.pdf',
    extension: 'pdf',
    sizeBytes: 1468006,
    textContent:
      'LAYERNORM / RESEARCH\n\n## A simpler starting point\n\nPricing should make it easy to begin. The best plans connect a clear outcome with the capacity to use it.\n\n### What customers told us\n\n“I want to know what I can accomplish, not how many features are included.”\n\nOur recommendation is to keep the first plan focused and move the details into a comparison.\n\n1 / 6',
  },
  {
    ...base,
    _id: 'image',
    type: 'file',
    kind: 'upload',
    name: 'Mobile preview.png',
    extension: 'png',
    sizeBytes: 862208,
  },
]
files.push(
  ...['launch', 'brand'].flatMap((parentId) =>
    [1, 2, 3, 4].map((index) => ({
      ...base,
      _id: parentId + index,
      parentId,
      type: 'note',
      kind: 'note',
      name: `Working note ${index}`,
    })),
  ),
)
const automation: AutomationSummary = {
  _id: 'daily',
  name: 'Morning briefing',
  description: 'A short summary of what needs your attention, delivered each morning.',
  enabled: true,
  schedule: { kind: 'daily', hourUTC: 9, minuteUTC: 0 },
  timezone: 'UTC',
  createdAt: time,
  updatedAt: time,
}
const runs: AutomationRunSummary[] = [
  {
    _id: 'live',
    automationId: 'daily',
    status: 'running',
    workflowRunId: 'workflow',
    scheduledFor: time,
    createdAt: time,
  },
  {
    _id: 'prior',
    automationId: 'daily',
    status: 'completed',
    scheduledFor: time - 86400000,
    createdAt: time - 86400000,
  },
]
const activity: WorkspaceNotification[] = [
  'Pricing review is ready',
  'Needs your input',
  'Mentioned you in #product',
  'Replied to your thread',
].map((title, index) => ({
  id: String(index),
  workspaceId: 'fixture',
  recipientPrincipalId: 'you',
  actorPrincipalId: String(index),
  type: index === 2 ? 'mention' : index === 3 ? 'thread' : 'message',
  title,
  body: [
    'Overlay · 8 min ago',
    'Scout · 12 min ago',
    'Divyansh · 24 min ago',
    'Builder · 1 hour ago',
  ][index],
  createdAt: time - index * 60000,
  ...(index > 1 ? { readAt: time } : {}),
}))
const actors = {
  '0': { name: 'Overlay', principalType: 'agent', isDefault: true },
  '1': {
    name: 'Scout',
    principalType: 'agent',
    isDefault: false,
    avatarColor: '#77a677',
    avatarShape: 'cloud',
  },
  '2': { name: 'Divyansh', principalType: 'human' },
  '3': {
    name: 'Builder',
    principalType: 'agent',
    isDefault: false,
    avatarColor: '#aa88bb',
    avatarShape: 'squircle',
  },
}

export function ResourceFixture({
  initialScreen = 'activity-feed',
  dark = false,
  empty = false,
  error = false,
  onAction = () => {},
}: {
  initialScreen?: string
  dark?: boolean
  empty?: boolean
  error?: boolean
  onAction?: (action: string) => void
}) {
  const theme = getTheme(dark)
  const [screen, setScreen] = useState(initialScreen)
  const [parentId, setParentId] = useState<string | null>(null)
  const [filter, setFilter] = useState<WorkspaceNotificationFilter>('all')
  const [items, setItems] = useState(activity)
  const [query, setQuery] = useState('launch')
  const [paused, setPaused] = useState(false)
  const act = (value: string) => onAction(value)
  const content = error ? (
    <ResourceState
      theme={theme}
      error="Could not load this workspace. Try again."
      onRetry={() => act('retry')}
    />
  ) : screen === 'activity-feed' ? (
    <ActivityFeed
      theme={theme}
      dark={dark}
      actors={actors}
      items={empty ? [] : items}
      filter={filter}
      onFilter={setFilter}
      onOpen={(item) => act(item.id)}
      onReadAll={() => setItems((rows) => rows.map((row) => ({ ...row, readAt: time })))}
      onBugReport={() => act('bug-report')}
    />
  ) : screen === 'files-list' ? (
    <FilesBrowser
      theme={theme}
      files={empty ? [] : files}
      parentId={parentId}
      onFolder={setParentId}
      onOpen={(file) => setScreen(file.kind === 'note' ? 'note' : 'file-preview')}
      onAdd={() => act('add-file')}
    />
  ) : screen === 'note' ? (
    <NoteDocument
      theme={theme}
      file={files[2]}
      now={time + 20000}
      onOptions={() => act('note-options')}
      onSave={async (value) => {
        act('saved')
        return { title: value.title, content: value.content, updatedAt: time + 1 }
      }}
    />
  ) : screen === 'file-preview' ? (
    <FilePaper theme={theme} file={files[3]} onDownload={() => act('download')} />
  ) : screen === 'automations-list' ? (
    <AutomationList
      theme={theme}
      items={
        empty
          ? []
          : [
              automation,
              {
                ...automation,
                _id: 'weekly',
                name: 'Weekly review',
                description: 'Review progress and plan the week ahead.',
              },
              {
                ...automation,
                _id: 'followups',
                name: 'Follow-up reminders',
                description: 'Keep the small things from slipping through.',
                enabled: false,
              },
            ]
      }
      onOpen={() => setScreen('automation-detail')}
      onNew={() => act('new-automation')}
    />
  ) : screen === 'automation-detail' ? (
    <AutomationDetail
      theme={theme}
      item={{ ...automation, enabled: !paused }}
      runs={empty ? [] : runs}
      step="Preparing today’s briefing"
      schedule="Every day at 9:00 AM"
      onRun={() => act('run-now')}
      onToggle={() => setPaused((value) => !value)}
      onEdit={() => act('edit-automation')}
      onOpenRun={() => act('open-run')}
    />
  ) : (
    <SearchResults
      theme={theme}
      dark={dark}
      query={query}
      onQuery={setQuery}
      results={
        empty || !'launch'.includes(query.toLowerCase())
          ? []
          : [
              {
                kind: 'work',
                id: 'work',
                title: 'Prepare mobile beta launch',
                subtitle: 'Builder · In progress',
              },
              {
                kind: 'file',
                id: 'note',
                title: 'Launch checklist',
                subtitle: 'Note · Edited 20 minutes ago',
              },
              {
                kind: 'conversation',
                id: 'product',
                title: 'product',
                subtitle: 'The mobile beta is ready for a final pass.',
              },
            ]
      }
      people={
        empty
          ? []
          : [
              {
                id: 'scout',
                name: 'Scout',
                subtitle: 'Agent',
                agent: {
                  name: 'Scout',
                  avatarShape: 'circle',
                  avatarColor: '#aa8877',
                  isDefault: false,
                },
              },
              { id: 'divyansh', name: 'Divyansh Lalwani', subtitle: 'Member' },
            ]
      }
      onOpen={(result) => {
        act(result.kind)
        if (result.kind === 'file') setScreen('note')
      }}
      onPerson={(id) => act('mention:' + id)}
    />
  )
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      <View
        style={{
          height: 52,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 24,
        }}
      >
        <T style={{ color: theme.foreground, fontSize: 12 }}>9:41</T>
        <View style={{ flexDirection: 'row', gap: 5 }}>
          <Signal size={13} color={theme.foreground} />
          <Wifi size={13} color={theme.foreground} />
          <BatteryFull size={17} color={theme.foreground} />
        </View>
      </View>
      <ResourcePage
        theme={theme}
        section={
          screen === 'activity-feed'
            ? 'Activity'
            : screen.includes('automation')
              ? 'Automations'
              : screen === 'search-mentions'
                ? 'Search'
                : 'Files'
        }
        onDrawer={() => act('drawer')}
        onSearch={() => setScreen('search-mentions')}
      >
        {content}
      </ResourcePage>
    </View>
  )
}
