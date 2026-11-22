import React, { useState } from 'react'
import { CreatureEmpty } from '../creatures/CreatureEmpty'
import { Stack } from 'expo-router'
import { ActivityIndicator, Image, Pressable, ScrollView, TextInput, View } from 'react-native'
import {
  AtSign,
  Bell,
  Bug,
  Check,
  ChevronRight,
  Download,
  File,
  FileText,
  Folder,
  Hash,
  ListChecks,
  MoreHorizontal,
  Plus,
  Search,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react-native'
import { EnrichedMarkdownText } from 'react-native-enriched-markdown'
import type { AutomationRunSummary, AutomationSummary, KnowledgeFile } from '@overlay/app-core'
import type {
  WorkspaceNotification,
  WorkspaceNotificationFilter,
} from '@overlay/workspace-contracts'
import type { Theme } from '../../constants/theme'
import { T, Button, IconButton } from '../shell/primitives'
import type { WorkspaceSearchResult } from '../../services/searchService'
import { BottomSheet } from '../ui/AppChrome'
import { AgentAvatar } from '../shell/AgentAvatar'
import { filterNotifications } from '../../lib/activity'
import { formatSchedule } from '../../lib/automationSchedule'
import { normalizeHtmlForMobileMarkdown } from '../../services/noteContentFormat'

export const ACTIVITY_FILTERS: WorkspaceNotificationFilter[] = [
  'all',
  'unread',
  'mentions',
  'threads',
  'reactions',
]
export const RUN_TERMINAL = new Set([
  'completed',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
  'dead_letter',
])
export function fileMatches(file: KnowledgeFile, query: string) {
  return file.name.toLowerCase().includes(query.trim().toLowerCase())
}
export function readableStep(name: string) {
  return (name.split('//').filter(Boolean).at(-1) ?? name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
}
export function resourceDate(time: number) {
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
export function fileSubtitle(file: KnowledgeFile) {
  return file.kind === 'note'
    ? `Note · Edited ${resourceDate(file.updatedAt)}`
    : `${file.extension?.toUpperCase() || file.kind || 'File'}${file.sizeBytes ? ' · ' + (file.sizeBytes >= 1048576 ? (file.sizeBytes / 1048576).toFixed(1) + ' MB' : Math.ceil(file.sizeBytes / 1024) + ' KB') : ''}`
}

/**
 * A resource screen inside a native stack: the navigation bar supplies the
 * title and back button; content scrolls under it.
 */
export function ResourcePage({
  theme,
  title,
  onBack,
  children,
}: {
  theme: Theme
  /** Navigation-bar title. Omit to keep the title the stack already set. */
  title?: string
  /** In-screen sub-page: replaces the system back button until the page closes. */
  onBack?: () => void
  children: React.ReactNode
}) {
  return (
    <>
      {title !== undefined || onBack ? (
        <Stack.Screen
          options={{
            ...(title !== undefined ? { title } : {}),
            headerBackVisible: !onBack,
            gestureEnabled: !onBack,
          }}
        />
      ) : null}
      {onBack ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="chevron.backward" accessibilityLabel="Back" onPress={onBack} />
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }}
      >
        {children}
      </ScrollView>
    </>
  )
}
/**
 * Page title. A full heading becomes the native large navigation title (no
 * duplicate in-page heading); a compact heading stays inline for document
 * titles that are part of the content.
 */
export function ResourceHeading({
  theme,
  title,
  action,
  compact = false,
}: {
  theme: Theme
  title: string
  action?: React.ReactNode
  compact?: boolean
}) {
  if (!compact) {
    return (
      <>
        <Stack.Screen options={{ title, headerLargeTitle: true }} />
        {action ? <View style={{ alignItems: 'flex-end', marginBottom: 8 }}>{action}</View> : null}
      </>
    )
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 22 }}>
      <T
        style={{
          color: theme.foreground,
          fontFamily: 'GeistMedium',
          fontSize: 20,
          letterSpacing: -0.5,
          flex: 1,
        }}
      >
        {title}
      </T>
      {action}
    </View>
  )
}
export function ResourceSheet(props: React.ComponentProps<typeof BottomSheet>) {
  return (
    <BottomSheet
      {...props}
      solid
      headerAction={
        <IconButton theme={props.theme} icon={X} label="Close" onPress={props.onClose} />
      }
    />
  )
}
export function ResourceLabel({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <T style={{ color: theme.muted, fontSize: 11, marginTop: 22, marginBottom: 10 }}>{children}</T>
  )
}
export function ResourceState({
  theme,
  loading,
  error,
  empty,
  onRetry,
}: {
  theme: Theme
  loading?: boolean
  error?: string | null
  empty?: string
  onRetry?: () => void
}) {
  return loading ? (
    <ActivityIndicator accessibilityLabel="Loading" color={theme.muted} style={{ margin: 30 }} />
  ) : (
    <View style={{ paddingVertical: 24, gap: 12 }}>
      <T accessibilityRole={error ? 'alert' : 'text'} style={{ color: theme.muted, fontSize: 13 }}>
        {error || empty || 'No items yet.'}
      </T>
      {error && onRetry ? (
        <Button secondary theme={theme} onPress={onRetry}>
          Try again
        </Button>
      ) : null}
    </View>
  )
}
export function ResourceInput({
  theme,
  value,
  onChange,
  placeholder,
}: {
  theme: Theme
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        borderRadius: 8,
        backgroundColor: theme.surfaceSubtle,
        paddingHorizontal: 12,
        minHeight: 42,
      }}
    >
      <Search size={15} color={theme.muted} />
      <TextInput
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        value={value}
        onChangeText={onChange}
        style={{
          flex: 1,
          minHeight: 42,
          fontFamily: 'Geist',
          fontSize: 14,
          color: theme.foreground,
        }}
      />
    </View>
  )
}
export function ResourceTabs<Tab extends string>({
  theme,
  options,
  value,
  onChange,
}: {
  theme: Theme
  options: readonly Tab[]
  value: Tab
  onChange: (value: Tab) => void
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 4 }}
      style={{ flexGrow: 0 }}
    >
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4 }}>
        {options.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected: option === value }}
            onPress={() => onChange(option)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: option === value ? theme.surfaceSubtle : 'transparent',
            }}
          >
            <T style={{ color: option === value ? theme.foreground : theme.muted, fontSize: 12 }}>
              {option[0].toUpperCase() + option.slice(1)}
            </T>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  )
}
export function ResourceRow({
  theme,
  icon: Icon = FileText,
  title,
  subtitle,
  onPress,
  trailing,
  leading,
}: {
  theme: Theme
  icon?: LucideIcon
  title: string
  subtitle?: string
  onPress?: () => void
  trailing?: React.ReactNode
  leading?: React.ReactNode
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
        paddingVertical: 13,
        borderRadius: 7,
        backgroundColor: pressed ? theme.surfaceSubtle : 'transparent',
      })}
    >
      {leading ?? <Icon size={18} color={theme.muted} />}
      <View style={{ flex: 1, gap: 4 }}>
        <T style={{ color: theme.foreground, fontSize: 13, fontFamily: 'GeistMedium' }}>{title}</T>
        {subtitle ? (
          <T style={{ color: theme.muted, fontSize: 11, lineHeight: 17 }}>{subtitle}</T>
        ) : null}
      </View>
      {trailing ?? (onPress ? <ChevronRight size={12} color={theme.muted} /> : null)}
    </Pressable>
  )
}

export type ResourceActor = {
  name: string
  principalType?: string
  isDefault?: boolean
  avatarShape?: string
  avatarColor?: string
}
export function ResourceAvatar({
  theme,
  dark,
  actor,
}: {
  theme: Theme
  dark: boolean
  actor: ResourceActor
}) {
  return actor.principalType === 'agent' ? (
    <AgentAvatar agent={actor} dark={dark} foreground={theme.foreground} size={22} />
  ) : (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.surfaceSubtle,
      }}
    >
      <T style={{ color: theme.muted, fontSize: 10 }}>
        {actor.name
          .split(' ')
          .map((word) => word[0])
          .slice(0, 2)
          .join('')}
      </T>
    </View>
  )
}

export function ActivityFeed({
  theme,
  items,
  filter,
  onFilter,
  onOpen,
  onReadAll,
  onBugReport,
  actors = {},
  dark = false,
}: {
  theme: Theme
  items: WorkspaceNotification[]
  filter: WorkspaceNotificationFilter
  onFilter: (filter: WorkspaceNotificationFilter) => void
  onOpen: (item: WorkspaceNotification) => void
  onReadAll: () => void
  onBugReport: () => void
  actors?: Record<string, ResourceActor>
  dark?: boolean
}) {
  const visible = filterNotifications(items, filter)
  return (
    <>
      <ResourceHeading theme={theme} title="Activity" />
      <ResourceTabs theme={theme} options={ACTIVITY_FILTERS} value={filter} onChange={onFilter} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 22,
          marginBottom: 10,
        }}
      >
        <T style={{ color: theme.muted, fontSize: 11 }}>
          {visible.length ? resourceDate(visible[0].createdAt) : ''}
        </T>
        {items.some((item) => !item.readAt) ? (
          <Pressable accessibilityRole="button" onPress={onReadAll} hitSlop={8}>
            <T style={{ color: theme.muted, fontSize: 11 }}>Mark all read</T>
          </Pressable>
        ) : null}
      </View>
      {!visible.length ? <ResourceState theme={theme} empty="No activity yet" /> : null}
      {visible.map((item, index) => (
        <View
          key={item.id}
          style={{
            backgroundColor: item.readAt ? 'transparent' : theme.surfaceMuted,
            borderRadius: 10,
            paddingHorizontal: 12,
          }}
        >
          {index > 0 &&
          resourceDate(item.createdAt) !== resourceDate(visible[index - 1].createdAt) ? (
            <ResourceLabel theme={theme}>{resourceDate(item.createdAt)}</ResourceLabel>
          ) : null}
          <ResourceRow
            theme={theme}
            icon={item.type === 'mention' ? AtSign : item.type === 'thread' ? Hash : Bell}
            leading={
              actors[item.actorPrincipalId ?? ''] ? (
                <ResourceAvatar
                  theme={theme}
                  dark={dark}
                  actor={actors[item.actorPrincipalId ?? '']}
                />
              ) : undefined
            }
            title={item.title}
            subtitle={item.body || resourceDate(item.createdAt)}
            onPress={() => onOpen(item)}
            trailing={
              !item.readAt ? (
                <View
                  accessibilityLabel="Unread"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: theme.foreground,
                  }}
                />
              ) : (
                false
              )
            }
          />
        </View>
      ))}
      <View style={{ marginTop: 24 }}>
        <ResourceRow
          theme={theme}
          icon={Bug}
          title="Submit a bug"
          subtitle="Help improve Overlay"
          onPress={onBugReport}
        />
      </View>
    </>
  )
}

export function FilesBrowser({
  theme,
  files,
  parentId,
  onFolder,
  onOpen,
  onAdd,
  query: nativeQuery,
}: {
  theme: Theme
  files: KnowledgeFile[]
  parentId: string | null
  onFolder: (id: string | null) => void
  onOpen: (file: KnowledgeFile) => void
  onAdd?: () => void
  /** Search text from the native navigation-bar search field. */
  query?: string
}) {
  const [inlineQuery, setQuery] = useState('')
  const query = nativeQuery ?? inlineQuery
  const visible = files.filter((file) =>
    query.trim() ? fileMatches(file, query) : file.parentId === parentId,
  )
  const folders = visible.filter((file) => file.type === 'folder' || file.kind === 'folder')
  const recent = visible
    .filter((file) => file.type !== 'folder' && file.kind !== 'folder')
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <>
      {onAdd ? (
        <>
          <ResourceHeading
            theme={theme}
            title={parentId ? files.find((file) => file._id === parentId)?.name || 'Folder' : 'Files'}
            action={<IconButton theme={theme} icon={Plus} label="Add file" onPress={onAdd} />}
          />
          <ResourceInput theme={theme} value={query} onChange={setQuery} placeholder="Search files" />
        </>
      ) : null}
      {parentId && onAdd ? (
        <Button
          theme={theme}
          onPress={() => onFolder(files.find((file) => file._id === parentId)?.parentId ?? null)}
        >
          Back to parent
        </Button>
      ) : null}
      {folders.length ? (
        <>
          <ResourceLabel theme={theme}>Folders</ResourceLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {folders.map((folder) => (
              <Pressable
                key={folder._id}
                accessibilityRole="button"
                accessibilityLabel={folder.name}
                onPress={() => {
                  setQuery('')
                  onFolder(folder._id)
                }}
                style={{
                  width: '48%',
                  minHeight: 118,
                  backgroundColor: theme.surfaceMuted,
                  borderWidth: 1,
                  borderColor: theme.surfaceMuted,
                  borderRadius: 10,
                  padding: 16,
                  gap: 10,
                }}
              >
                <Folder size={23} color={theme.muted} />
                <T style={{ color: theme.foreground, fontSize: 14, fontFamily: 'GeistMedium' }}>
                  {folder.name}
                </T>
                <T style={{ color: theme.muted, fontSize: 11 }}>
                  {files.filter((file) => file.parentId === folder._id).length} files
                </T>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <ResourceLabel theme={theme}>{query.trim() ? 'Results' : 'Recent'}</ResourceLabel>
      {!visible.length ? (
        query.trim() ? (
          <ResourceState theme={theme} empty="No matching files" />
        ) : (
          <CreatureEmpty
            title="No files yet"
            detail="Files you upload and files your agents make show up here."
            shape="cloud"
            color="#2563eb"
          />
        )
      ) : null}
      {recent.map((file) => (
        <ResourceRow
          key={file._id}
          theme={theme}
          icon={file.kind === 'note' ? FileText : File}
          title={file.name}
          subtitle={fileSubtitle(file)}
          onPress={() => onOpen(file)}
        />
      ))}
    </>
  )
}

export function FilePaper({
  theme,
  file,
  onDownload,
  image,
}: {
  theme: Theme
  file: KnowledgeFile
  onDownload: () => void
  image?: { uri: string; headers: Record<string, string> }
}) {
  const text = file.textContent ?? (file.kind === 'note' ? file.content : '') ?? ''
  return (
    <>
      <ResourceHeading
        compact
        theme={theme}
        title={file.name}
        action={
          <IconButton theme={theme} icon={Download} label="Download file" onPress={onDownload} />
        }
      />
      <T style={{ color: theme.muted, fontSize: 11, marginTop: -14, marginBottom: 24 }}>
        {fileSubtitle(file)}
      </T>
      <View
        style={{
          padding: 24,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 6,
          minHeight: 390,
          backgroundColor: theme.surfaceMuted,
        }}
      >
        {image ? (
          <FileImage source={image} theme={theme} />
        ) : text ? (
          <DocumentMarkdown compact theme={theme} text={text} />
        ) : (
          <ResourceState
            theme={theme}
            empty="Preview is unavailable on this device. Download the file to open it in another app."
          />
        )}
      </View>
    </>
  )
}

export function FileImage({
  source,
  theme,
}: {
  source: { uri: string; headers: Record<string, string> }
  theme: Theme
}) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <ResourceState
      theme={theme}
      error="Could not load this image."
      onRetry={() => setFailed(false)}
    />
  ) : (
    <Image
      alt="File preview"
      accessibilityLabel="File preview"
      source={source}
      resizeMode="contain"
      style={{ width: '100%', aspectRatio: 1 }}
      onError={() => setFailed(true)}
    />
  )
}
export function DocumentMarkdown({
  theme,
  text,
  compact = false,
}: {
  theme: Theme
  text: string
  compact?: boolean
}) {
  return (
    <EnrichedMarkdownText
      markdown={text}
      flavor="github"
      markdownStyle={{
        paragraph: {
          fontFamily: 'Geist',
          fontSize: compact ? 12 : 14,
          lineHeight: compact ? 20 : 25,
          color: theme.foreground,
          marginBottom: 16,
        },
        h1: { fontFamily: 'GeistMedium', fontSize: 25, color: theme.foreground, marginBottom: 16 },
        h2: {
          fontFamily: 'GeistMedium',
          fontSize: 20,
          color: theme.foreground,
          marginTop: 18,
          marginBottom: 14,
        },
        h3: {
          fontFamily: 'GeistMedium',
          fontSize: 14,
          color: theme.foreground,
          marginTop: 18,
          marginBottom: 12,
        },
        strong: { color: theme.foreground },
        taskList: {
          checkedColor: theme.foreground,
          borderColor: theme.border,
          checkmarkColor: theme.surface,
          checkedTextColor: theme.muted,
          checkedStrikethrough: true,
        },
        list: { color: theme.foreground, fontSize: 14 },
        link: { color: theme.foreground },
      }}
    />
  )
}

export function NoteDocument({
  theme,
  file,
  onSave,
  onOptions,
  now,
}: {
  theme: Theme
  file: KnowledgeFile
  now?: number
  onSave: (value: {
    title: string
    content: string
    expectedUpdatedAt: number
  }) => Promise<{ title: string; content: string; updatedAt: number }>
  onOptions: () => void
}) {
  const incoming = {
    title: file.name,
    content: normalizeHtmlForMobileMarkdown(file.textContent ?? file.content ?? ''),
    updatedAt: file.updatedAt,
  }
  const [base, setBase] = useState(incoming)
  const [clock, setClock] = useState(Date.now)
  const [title, setTitle] = useState(incoming.title)
  const [content, setContent] = useState(incoming.content)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = title !== base.title || content !== base.content
  if (!dirty && !saving && incoming.updatedAt > base.updatedAt) {
    setBase(incoming)
    setTitle(incoming.title)
    setContent(incoming.content)
  }
  async function save() {
    if (saving || !dirty) return
    setSaving(true)
    setError(null)
    try {
      const saved = await onSave({
        title: title.trim() || 'Untitled',
        content,
        expectedUpdatedAt: base.updatedAt,
      })
      setBase(saved)
      setClock(Date.now())
      setTitle((current) => (current === title ? saved.title : current))
      setContent((current) => (current === content ? saved.content : current))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save this note. Your draft is still here.',
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
        <T style={{ color: theme.muted, fontSize: 11, flex: 1 }}>
          {saving
            ? 'Saving…'
            : dirty
              ? 'Unsaved changes'
              : Math.abs((now ?? clock) - base.updatedAt) < 60000
                ? 'Saved just now'
                : `Saved ${resourceDate(base.updatedAt)}`}
        </T>
        {editing ? (
          <Button theme={theme} onPress={() => setEditing(false)}>
            Preview
          </Button>
        ) : null}
        <IconButton theme={theme} icon={MoreHorizontal} label="Note options" onPress={onOptions} />
      </View>
      {editing ? (
        <>
          <TextInput
            accessibilityLabel="Note title"
            value={title}
            onChangeText={setTitle}
            maxLength={100}
            style={{
              fontFamily: 'GeistMedium',
              fontSize: 25,
              color: theme.foreground,
              marginBottom: 20,
            }}
          />
          <TextInput
            accessibilityLabel="Note content"
            multiline
            textAlignVertical="top"
            value={content}
            onChangeText={setContent}
            style={{
              minHeight: 300,
              fontFamily: 'Geist',
              fontSize: 14,
              lineHeight: 25,
              color: theme.foreground,
            }}
          />
          <Button
            secondary
            theme={theme}
            disabled={saving || !dirty}
            onPress={() => {
              void save()
            }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit note content"
          onPress={() => setEditing(true)}
        >
          <ResourceHeading theme={theme} title={title} />
          <DocumentMarkdown theme={theme} text={content || 'Start writing…'} />
        </Pressable>
      )}
      {error ? <ResourceState theme={theme} error={error} /> : null}
    </>
  )
}

export function AutomationList({
  theme,
  items,
  onOpen,
  onNew,
}: {
  theme: Theme
  items: AutomationSummary[]
  onOpen: (item: AutomationSummary) => void
  onNew: () => void
}) {
  return (
    <>
      <ResourceHeading theme={theme} title="Automations" />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="New automation" onPress={onNew} />
      </Stack.Toolbar>
      {!items.length ? <ResourceState theme={theme} empty="No automations yet" /> : null}
      {[true, false].map((enabled) => (
        <View key={String(enabled)}>
          {items.some((item) => (item.enabled !== false) === enabled) ? (
            <ResourceLabel theme={theme}>{enabled ? 'Active' : 'Paused'}</ResourceLabel>
          ) : null}
          {items
            .filter((item) => (item.enabled !== false) === enabled)
            .map((item) => (
              <ResourceRow
                key={item._id}
                theme={theme}
                icon={Workflow}
                title={item.name || item.title || 'Automation'}
                subtitle={formatSchedule(item.schedule)}
                onPress={() => onOpen(item)}
                trailing={
                  <T
                    style={{
                      color: theme.muted,
                      fontSize: 10,
                      backgroundColor: theme.surfaceSubtle,
                      borderRadius: 12,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                    }}
                  >
                    {enabled ? 'Active' : 'Paused'}
                  </T>
                }
              />
            ))}
        </View>
      ))}
    </>
  )
}
export function AutomationDetail({
  theme,
  item,
  runs,
  step,
  schedule,
  onRun,
  onToggle,
  onEdit,
  onOpenRun,
  busy = false,
}: {
  theme: Theme
  item: AutomationSummary
  runs: AutomationRunSummary[]
  step?: string
  schedule: string
  onRun: () => void
  onToggle: () => void
  onEdit: () => void
  onOpenRun: (run: AutomationRunSummary) => void
  busy?: boolean
}) {
  const active = runs.find((run) => !RUN_TERMINAL.has(run.status))
  const history = runs.filter((run) => RUN_TERMINAL.has(run.status))
  return (
    <>
      <ResourceHeading
        theme={theme}
        title={item.name || item.title || 'Automation'}
        action={
          <IconButton
            theme={theme}
            icon={MoreHorizontal}
            label="Automation options"
            onPress={onEdit}
          />
        }
      />
      <T
        style={{
          color: theme.muted,
          fontSize: 13,
          lineHeight: 22,
          marginTop: -8,
          marginBottom: 20,
        }}
      >
        {item.description}
      </T>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
        <T style={{ color: theme.muted, fontSize: 12 }}>Schedule</T>
        <T style={{ color: theme.foreground, fontSize: 12 }}>{schedule}</T>
      </View>
      {active ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View live run"
          onPress={() => onOpenRun(active)}
          style={{
            padding: 16,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 10,
            marginVertical: 20,
            gap: 14,
          }}
        >
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={theme.muted} />
            <T
              style={{ color: theme.foreground, fontSize: 13, fontFamily: 'GeistMedium', flex: 1 }}
            >
              {step ? readableStep(step) : 'Running automation'}
            </T>
          </View>
          <View style={{ height: 3, borderRadius: 2, backgroundColor: theme.surfaceSubtle }} />
          <T style={{ color: theme.muted, fontSize: 11 }}>{active.status.replaceAll('_', ' ')}</T>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 12, marginVertical: 18 }}>
        <Button theme={theme} secondary onPress={onRun} disabled={busy}>
          Run now
        </Button>
        <Button theme={theme} onPress={onToggle} disabled={busy}>
          {item.enabled === false ? 'Resume' : 'Pause'}
        </Button>
      </View>
      <ResourceLabel theme={theme}>Run history</ResourceLabel>
      {!history.length ? <ResourceState theme={theme} empty="No completed runs yet" /> : null}
      {history.map((run) => (
        <ResourceRow
          theme={theme}
          key={run._id}
          icon={Check}
          title={new Date(run.createdAt).toLocaleString()}
          subtitle={run.status + (run.error ? ' · ' + run.error : '')}
          onPress={() => onOpenRun(run)}
        />
      ))}
    </>
  )
}

export function SearchResults({
  theme,
  query,
  onQuery,
  results,
  people = [],
  onOpen,
  onPerson,
  loading = false,
  dark = false,
}: {
  theme: Theme
  query: string
  onQuery: (value: string) => void
  results: WorkspaceSearchResult[]
  loading?: boolean
  dark?: boolean
  people?: Array<{
    id: string
    name: string
    subtitle: string
    agent?: { name: string; isDefault?: boolean; avatarColor?: string; avatarShape?: string }
  }>
  onOpen: (result: WorkspaceSearchResult) => void
  onPerson: (id: string) => void
}) {
  const [tab, setTab] = useState('All')
  const groupKinds = {
    Work: 'work',
    Chats: 'conversation',
    Files: 'file',
    Automations: 'automation',
  } as const
  const visible = results.filter(
    (result) => tab === 'All' || groupKinds[tab as keyof typeof groupKinds] === result.kind,
  )
  return (
    <>
      <ResourceInput
        theme={theme}
        value={query}
        onChange={onQuery}
        placeholder="Search workspace"
      />
      <View style={{ marginTop: 18 }}>
        <ResourceTabs
          theme={theme}
          options={['All', 'Work', 'Chats', 'Files', 'Automations']}
          value={tab}
          onChange={setTab}
        />
      </View>
      {Object.entries(groupKinds).map(([name, kind]) => (
        <View key={name}>
          {visible.some((result) => result.kind === kind) ? (
            <ResourceLabel theme={theme}>{name}</ResourceLabel>
          ) : null}
          {visible
            .filter((result) => result.kind === kind)
            .map((result) => (
              <ResourceRow
                key={result.kind + result.id}
                theme={theme}
                icon={
                  kind === 'work'
                    ? ListChecks
                    : kind === 'conversation'
                      ? Hash
                      : kind === 'automation'
                        ? Workflow
                        : FileText
                }
                title={result.title}
                subtitle={result.snippet || result.subtitle}
                onPress={() => onOpen(result)}
              />
            ))}
        </View>
      ))}
      {people.length && tab === 'All' ? (
        <>
          <ResourceLabel theme={theme}>Mention someone</ResourceLabel>
          {people.map((person) => (
            <ResourceRow
              key={person.id}
              theme={theme}
              icon={AtSign}
              title={person.name}
              subtitle={person.subtitle}
              leading={false}
              trailing={
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <ResourceAvatar
                    theme={theme}
                    dark={dark}
                    actor={
                      person.agent
                        ? { ...person.agent, principalType: 'agent' }
                        : { name: person.name, principalType: 'human' }
                    }
                  />
                  <ChevronRight size={12} color={theme.muted} />
                </View>
              }
              onPress={() => onPerson(person.id)}
            />
          ))}
        </>
      ) : null}
      {!loading && query.trim().length >= 2 && !visible.length && !people.length ? (
        <ResourceState theme={theme} empty="No results" />
      ) : null}
    </>
  )
}
