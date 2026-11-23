import React, { useState } from 'react'
import { Picker, Section, Text } from '@expo/ui/swift-ui'
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'
import { api, mutateConvex, type Id } from '../../services/convexClient'
import { getRequestWorkspaceId } from '../../services/appApi'
import { useLiveResource } from '../../hooks/useLiveResource'

const LEVELS = [
  ['all', 'All messages'],
  ['mentions', 'Mentions only'],
  ['muted', 'Muted'],
] as const
type Level = (typeof LEVELS)[number][0]

/**
 * Form sections for one conversation's notification level: reads the live
 * room state, saves through the same mutation as web, and refuses to write
 * once the app has switched to another workspace.
 */
export function RoomNotifications({ workspaceId, conversationId }: { workspaceId: string; conversationId: string }) {
  const args = { workspaceId, conversationId: conversationId as Id<'conversations'> }
  const room = useLiveResource(api.collaboration.rooms.state, args)
  const [error, setError] = useState<string | null>(null)
  const current = room.data?.participants.find((row) => row.principalId === room.data?.currentPrincipalId)
  if (!current)
    return (
      <Section>
        <Text>{room.loading ? 'Loading…' : (room.error ?? 'This conversation is unavailable.')}</Text>
      </Section>
    )
  return (
    <Section
      title="Notify me about"
      footer={<Text>{error ?? 'Syncs with your workspace on every device.'}</Text>}
    >
      <Picker
        selection={current.notificationLevel ?? 'all'}
        onSelectionChange={(notificationLevel: Level) => {
          if (getRequestWorkspaceId() !== workspaceId) {
            setError('Workspace changed. Reopen these settings.')
            return
          }
          setError(null)
          void mutateConvex(api.collaboration.rooms.updateMyState, { ...args, notificationLevel }).catch((value) =>
            setError(value instanceof Error ? value.message : 'Could not save notifications.'),
          )
        }}
        modifiers={[pickerStyle('inline')]}
      >
        {LEVELS.map(([value, label]) => (
          <Text key={value} modifiers={[tag(value)]}>{label}</Text>
        ))}
      </Picker>
    </Section>
  )
}
