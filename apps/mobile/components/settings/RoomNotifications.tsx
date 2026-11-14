import React, { useState } from 'react'
import { View } from 'react-native'
import type { Theme } from '../../constants/theme'
import { api, mutateConvex, type Id } from '../../services/convexClient'
import { getRequestWorkspaceId } from '../../services/appApi'
import { useLiveResource } from '../../hooks/useLiveResource'
import { ResourceSheet, ResourceState } from '../knowledge/ResourceViews'
import { Button } from '../shell/primitives'
export function RoomNotifications({
  theme,
  workspaceId,
  conversationId,
  onClose,
}: {
  theme: Theme
  workspaceId: string
  conversationId: string
  onClose: () => void
}) {
  const args = { workspaceId, conversationId: conversationId as Id<'conversations'> }
  const room = useLiveResource(api.collaboration.rooms.state, args)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = room.data?.participants.find(
    (row) => row.principalId === room.data?.currentPrincipalId,
  )
  return (
    <ResourceSheet
      theme={theme}
      visible
      title="Conversation notifications"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <View style={{ gap: 12 }}>
        {room.loading || room.error || error || !current ? (
          <ResourceState
            theme={theme}
            loading={room.loading}
            error={room.error ?? error}
            empty="Conversation is unavailable."
            onRetry={room.retry}
          />
        ) : null}
        {current
          ? (['all', 'mentions', 'muted'] as const).map((notificationLevel) => (
              <Button
                key={notificationLevel}
                theme={theme}
                secondary={current.notificationLevel === notificationLevel}
                disabled={busy}
                onPress={() => {
                  if (getRequestWorkspaceId() !== workspaceId) {
                    setError('Workspace changed. Reopen these settings.')
                    return
                  }
                  setBusy(true)
                  setError(null)
                  void mutateConvex(api.collaboration.rooms.updateMyState, {
                    ...args,
                    notificationLevel,
                  })
                    .catch((value) =>
                      setError(
                        value instanceof Error ? value.message : 'Could not save notifications.',
                      ),
                    )
                    .finally(() => setBusy(false))
                }}
              >
                {notificationLevel === 'all'
                  ? 'All messages'
                  : notificationLevel === 'mentions'
                    ? 'Mentions only'
                    : 'Muted'}
              </Button>
            ))
          : null}
      </View>
    </ResourceSheet>
  )
}
