import React, { useRef, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import type { UpdateWorkItemRequest, WorkItem, WorkStatus } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { useWork } from '../../hooks/useWork'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAuth } from '../../contexts/AuthContext'
import { commentWork, moveWork, updateWork } from '../../services/workService'
import { canWorkOnItem } from '../../lib/work'
import { parseWorkErrorReason, workErrorMessage } from '../../../src/shared/work/errors'
import { Button } from '../shell/primitives'
import { CreatureEmpty } from '../creatures/CreatureEmpty'
import { WorkDetailView, WorkListView, workLayouts, type WorkLayout } from './WorkViews'
import { TabToolbar } from '../navigation/nativeHeader'
import { useMode } from '../../contexts/ModeContext'
import { RoomConfirmDialog, type RoomConfirmation } from '../chat/RoomSheets'
import { moveToWorkspace } from '../../services/scopeService'
import { moveToWorkspaceConfirmation } from '../../lib/moveToWorkspace'
import { workError } from './WorkForms'

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
  // Work follows the app's Workspace | Personal mode.
  const { mode: view } = useMode()
  const [layout, setLayout] = useState<WorkLayout>('List')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<RoomConfirmation | null>(null)
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
  const newTask = () => router.push({ pathname: '/work/new', params: { scope: view } })
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
        <Stack.Screen options={{ title: '', headerLargeTitle: false }} />
      ) : (
        <TabToolbar>
          <Stack.Toolbar.Menu icon="line.3.horizontal.decrease" accessibilityLabel="View options">
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
            <Stack.Toolbar.Button icon="plus" accessibilityLabel="New task" onPress={newTask} />
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
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
          <CreatureEmpty
            title={id ? 'Task unavailable' : 'Work is unavailable'}
            detail={
              data.error ??
              (id
                ? 'This task was removed or you no longer have access.'
                : 'Work is not turned on for you in this workspace.')
            }
            shape="squircle"
            color="#f59e0b"
            action={id ? 'Back to Work' : 'Try again'}
            onAction={id ? back : data.retry}
          />
        </ScrollView>
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
          onMoveToWorkspace={() => {
            const task = data.item
            if (!task || !workspaceId) return
            setConfirmation(
              moveToWorkspaceConfirmation(task.title || 'this task', () =>
                void perform(() => moveToWorkspace('work', task.id)),
              ),
            )
          }}
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
          onCreate={newTask}
          canCreate={view === 'personal' || data.context.canCreateInWorkspace}
          canEdit={canEdit}
          onMove={(item, move) =>
            workspaceId
              ? moveWork(workspaceId, { ...move, id: item.id }).then(
                  () => true,
                  (reason) => {
                    Alert.alert('Could not move the task', workError(reason, 'Try again in a moment.'))
                    return false
                  },
                )
              : Promise.resolve(false)
          }
          onSchedule={(item) => router.push({ pathname: '/work/schedule', params: { id: item.id, scope: view } })}
        />
      )}
      <RoomConfirmDialog request={confirmation} onClose={() => setConfirmation(null)} />
    </View>
  )
}
