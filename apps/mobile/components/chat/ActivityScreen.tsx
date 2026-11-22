import React, { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import type { WorkspaceNotificationFilter } from '@overlay/workspace-contracts'
import { api } from '../../services/convexClient'
import { useLiveResource } from '../../hooks/useLiveResource'
import { filterNotifications, markNotificationsRead } from '../../services/collaborationService'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { openNotificationDestination } from '../../lib/notificationRouting'
import { AUTH_BASE_URL } from '../../services/appConfig'
import { getRequestWorkspaceId } from '../../services/appApi'
import { useResourceScope } from '../knowledge/ResourceScreens'
import { ActivityFeed, ResourcePage, ResourceState } from '../knowledge/ResourceViews'

export function ActivityScreen() {
  const { activeWorkspaceId } = useWorkspace()
  return <ActivityBody key={activeWorkspaceId} />
}

function ActivityBody() {
  const { workspaceId, theme, isDark, router, top, openDrawer } = useResourceScope()
  const feed = useLiveResource(
    api.collaboration.activity.notifications,
    workspaceId ? { workspaceId } : null,
  )
  const people = useLiveResource(
    api.collaboration.management.view,
    workspaceId ? { workspaceId, view: 'people' } : null,
  )
  const agents = useLiveResource(
    api.collaboration.management.view,
    workspaceId ? { workspaceId, view: 'chats-agents' } : null,
  )
  const actors = Object.fromEntries(
    [...(people.data?.items ?? []), ...(agents.data?.items ?? [])]
      .filter((item) => item.kind === 'member' && item.principalId)
      .map((item) => [item.principalId!, { ...item, name: item.name }]),
  )
  const [filter, setFilter] = useState<WorkspaceNotificationFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const unreadIds = JSON.stringify(
    filterNotifications(feed.data ?? [], filter)
      .filter((item) => !item.readAt)
      .map((item) => item.id),
  )
  useEffect(() => {
    const ids: string[] = JSON.parse(unreadIds)
    if (!workspaceId || !ids.length || getRequestWorkspaceId() !== workspaceId) return
    let active = true
    void markNotificationsRead(ids, workspaceId).catch(() => {
      if (active) setError('Could not mark activity as read.')
    })
    return () => {
      active = false
    }
  }, [workspaceId, unreadIds])
  return (
    <ResourcePage
      theme={theme}
      title="Activity"
    >
      {feed.data ? (
        <ActivityFeed
          theme={theme}
          dark={isDark}
          actors={actors}
          items={feed.data}
          filter={filter}
          onFilter={setFilter}
          onOpen={(item) => {
            const scope = workspaceId
            void markNotificationsRead([item.id], scope ?? undefined)
              .then(() => {
                if (getRequestWorkspaceId() === scope)
                  return openNotificationDestination(router, item)
              })
              .catch((cause) => setError(String(cause)))
          }}
          onReadAll={() => {
            if (workspaceId)
              void markNotificationsRead(
                feed.data?.filter((item) => !item.readAt).map((item) => item.id) ?? [],
                workspaceId,
              ).catch((cause) => setError(String(cause)))
          }}
          onBugReport={() =>
            Alert.alert(
              'Submit a bug',
              'Bug reports and attachments are public on GitHub. Open Help → Submit a bug on web to send your report.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Open on web',
                  onPress: () => {
                    void WebBrowser.openBrowserAsync(AUTH_BASE_URL + '/home').catch((cause) =>
                      setError(String(cause)),
                    )
                  },
                },
              ],
            )
          }
        />
      ) : (
        <ResourceState
          theme={theme}
          loading={feed.loading || !workspaceId}
          error={
            feed.error ||
            (feed.data === null ? 'Activity is unavailable in this workspace.' : undefined)
          }
          onRetry={feed.retry}
        />
      )}
      {error ? <ResourceState theme={theme} error={error} /> : null}
    </ResourcePage>
  )
}
