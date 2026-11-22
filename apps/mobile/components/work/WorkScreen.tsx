import React, { useRef, useState } from 'react'
import { ActivityIndicator, Modal, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type {
  CreateWorkItemRequest,
  UpdateWorkItemRequest,
  WorkItem,
  WorkStatus,
} from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { useWork } from '../../hooks/useWork'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAuth } from '../../contexts/AuthContext'
import {
  commentWork,
  createWork,
  moveWork,
  updateWork,
  type WorkView,
} from '../../services/workService'
import { getRequestWorkspaceId } from '../../services/appApi'
import { canWorkOnItem } from '../../lib/work'
import { parseWorkErrorReason, workErrorMessage } from '../../../src/shared/work/errors'
import { Button, T } from '../shell/primitives'
import { WorkComposer, WorkDetailView, WorkListView, workLayouts, type WorkLayout } from './WorkViews'
import { TabToolbar } from '../navigation/nativeHeader'
import { WorkPlacementSheet, WorkScheduleSheet } from './WorkTaskActions'

export function WorkScreen({ id }: { id?: string }) {
  const { activeWorkspaceId } = useWorkspace()
  return (
    <ConnectedWork
      key={`${activeWorkspaceId}:${id ?? ''}`}
      workspaceId={activeWorkspaceId}
      id={id}
    />
  )
}

function ConnectedWork({ workspaceId, id }: { workspaceId: string | null; id?: string }) {
  const { theme, isDark } = useTheme()
  const { user } = useAuth()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [view, setView] = useState<WorkView>('workspace')
  const [layout, setLayout] = useState<WorkLayout>('List')
  const [composer, setComposer] = useState(false)
  const [editor, setEditor] = useState<{ type: 'move' | 'schedule'; item: WorkItem } | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const data = useWork(workspaceId, view, id)
  async function perform(action: () => Promise<unknown>): Promise<boolean> {
    if (lock.current) return false
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
      return true
    } catch (reason) {
      const code = parseWorkErrorReason(reason)
      setError(
        code
          ? workErrorMessage(code)
          : reason instanceof Error
            ? reason.message
            : 'Unable to save this task.',
      )
      return false
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const back = () => router.dismissTo('/(tabs)/work')
  const onCreate = (input: CreateWorkItemRequest) =>
    perform(async () => {
      if (!workspaceId) throw new Error('Choose a workspace to continue.')
      const item = await createWork(workspaceId, input)
      if (getRequestWorkspaceId() === workspaceId) {
        setComposer(false)
        router.push(`/work/${item.id}` as never)
      }
    })
  const onPatch = (patch: UpdateWorkItemRequest) =>
    perform(async () => {
      if (!workspaceId || !id || !data.item) throw new Error('This task is no longer available.')
      await updateWork(workspaceId, id, { ...patch, expectedUpdatedAt: data.item.updatedAt })
    })
  const onStatus = (status: WorkStatus) =>
    perform(async () => {
      if (!workspaceId || !id) throw new Error('This task is no longer available.')
      await moveWork(workspaceId, { id, status })
    })
  const onComment = (body: string) =>
    perform(async () => {
      if (!workspaceId || !id) throw new Error('This task is no longer available.')
      await commentWork(workspaceId, id, body)
    })
  const policy = data.policy?.policy
  const canEdit = (item: WorkItem) =>
    Boolean(
      user &&
      data.context &&
      item.archivedAt === null &&
      canWorkOnItem(
        {
          userId: item.createdBy,
          scope: item.scope,
          assigneePrincipalId: item.assigneePrincipalId,
        },
        { userId: user.id, role: data.context.role },
        data.context.principalId,
        policy
          ? {
              workspaceContentEditors:
                policy.workspaceContentEditors === 'admins' ? 'admins' : 'members',
              workspaceExtensionsEditors:
                policy.workspaceExtensionsEditors === 'admins' ? 'admins' : 'members',
              memberCanMoveScope: policy.memberCanMoveScope !== false,
            }
          : undefined,
      ),
    )
  const unavailable = data.items === null || data.context === null || (id && data.item === null)
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {id ? (
        <Stack.Screen options={{ title: data.item?.title ?? '', headerLargeTitle: false }} />
      ) : (
        <TabToolbar>
          <Stack.Toolbar.Menu icon="line.3.horizontal.decrease" accessibilityLabel="View options">
            <Stack.Toolbar.Menu inline title="Scope">
              <Stack.Toolbar.MenuAction
                icon="building.2"
                isOn={view === 'workspace'}
                disabled={busy}
                onPress={() => setView('workspace')}
              >
                Workspace
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction
                icon="person"
                isOn={view === 'personal'}
                disabled={busy}
                onPress={() => setView('personal')}
              >
                Personal
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.Menu inline title="Layout">
              {workLayouts.map((entry) => (
                <Stack.Toolbar.MenuAction
                  key={entry}
                  icon={entry === 'List' ? 'list.bullet' : entry === 'Board' ? 'rectangle.split.3x1' : 'calendar.day.timeline.left'}
                  isOn={layout === entry}
                  onPress={() => setLayout(entry)}
                >
                  {entry}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            {user ? (
              <Stack.Toolbar.MenuAction
                icon="person.3.sequence"
                onPress={() => router.push({ pathname: '/work/organization', params: { scope: view } })}
              >
                Organization
              </Stack.Toolbar.MenuAction>
            ) : null}
          </Stack.Toolbar.Menu>
          {user && data.context && (view === 'personal' || data.context.canCreateInWorkspace) ? (
            <Stack.Toolbar.Button
              icon="plus"
              accessibilityLabel="New task"
              onPress={() => {
                setError(null)
                setComposer(true)
              }}
            />
          ) : null}
        </TabToolbar>
      )}
      {!user ? (
        <View style={{ padding: 24 }}>
          <Button theme={theme} onPress={() => router.replace('/auth-flow')}>
            Sign in to continue
          </Button>
        </View>
      ) : data.error || unavailable ? (
        <View style={{ padding: 24, gap: 16 }}>
          <T accessibilityRole="alert" style={{ color: theme.muted }}>
            {data.error ??
              (id
                ? 'This task is unavailable or you no longer have access.'
                : 'Work is not available in this workspace.')}
          </T>
          <Button theme={theme} onPress={data.retry}>
            Try again
          </Button>
          {id ? (
            <Button theme={theme} onPress={back}>
              Back to Work
            </Button>
          ) : null}
        </View>
      ) : !data.items || !data.context || (id && data.item === undefined) ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.muted} />
        </View>
      ) : id && data.item ? (
        <WorkDetailView
          item={data.item}
          items={data.items}
          context={data.context}
          events={data.events}
          thread={data.thread}
          theme={theme}
          dark={isDark}
          onThread={(conversationId) => router.push(`/dm/${conversationId}` as never)}
          onPatch={onPatch}
          onStatus={onStatus}
          onComment={onComment}
          busy={busy}
          error={error}
          editable={canEdit(data.item)}
        />
      ) : (
        <WorkListView
          layout={layout}
          items={data.items}
          context={data.context}
          userId={user.id}
          theme={theme}
          dark={isDark}
          onOpen={(taskId) => router.push(`/work/${taskId}` as never)}
          onCreate={() => {
            setError(null)
            setComposer(true)
          }}
          canCreate={view === 'personal' || data.context.canCreateInWorkspace}
          canEdit={canEdit}
          onMove={(item) => {
            setError(null)
            setEditor({ type: 'move', item })
          }}
          onSchedule={(item) => {
            setError(null)
            setEditor({ type: 'schedule', item })
          }}
        />
      )}
      {editor && workspaceId ? (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => {
            if (!busy) setEditor(null)
          }}
        >
          {editor.type === 'move' ? (
            <WorkPlacementSheet
              item={editor.item}
              items={data.items ?? []}
              theme={theme}
              busy={busy}
              error={error}
              onClose={() => {
                if (!busy) setEditor(null)
              }}
              onMove={(move) =>
                void perform(async () => {
                  await moveWork(workspaceId, { ...move, id: editor.item.id })
                  setEditor(null)
                })
              }
            />
          ) : (
            <WorkScheduleSheet
              item={editor.item}
              theme={theme}
              busy={busy}
              error={error}
              onClose={() => {
                if (!busy) setEditor(null)
              }}
              onSave={(dates) =>
                void perform(async () => {
                  await updateWork(workspaceId, editor.item.id, {
                    ...dates,
                    expectedUpdatedAt: editor.item.updatedAt,
                  })
                  setEditor(null)
                })
              }
            />
          )}
        </Modal>
      ) : null}
      <Modal
        visible={composer && Boolean(data.context)}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setComposer(false)
        }}
      >
        {data.context ? (
          <WorkComposer
            key={`${workspaceId}:${view}:${composer}`}
            theme={theme}
            dark={isDark}
            context={data.context}
            items={data.items ?? []}
            scope={view}
            onClose={() => setComposer(false)}
            onCreate={onCreate}
            busy={busy}
            error={error}
            bottomInset={insets.bottom}
          />
        ) : null}
      </Modal>
    </View>
  )
}
