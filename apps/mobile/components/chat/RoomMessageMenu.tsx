import React from 'react'
import { View, useWindowDimensions } from 'react-native'
import { Button, ContextMenu, Host, Menu, RNHostView } from '@expo/ui/swift-ui'
import { useTheme } from '../../hooks/useTheme'

export type RoomAction = 'reply' | 'thread' | 'pin' | 'save' | 'copy' | 'edit' | 'delete' | 'retry' | 'report'

const REACTIONS = ['👍', '❤️', '😂', '🎉', '✅', '👀', '🙏', '⭐'] as const

/**
 * Long-press menu for a room message, as the system context menu (the
 * message lifts and the menu appears beside it, like Messages). Deleted
 * messages get no menu; a failed send offers only Retry.
 */
export function RoomMessageMenu({
  children,
  mine,
  deleted = false,
  failed = false,
  pinned = false,
  saved = false,
  onReact,
  onAction,
}: {
  children: React.ReactElement
  mine: boolean
  deleted?: boolean
  failed?: boolean
  pinned?: boolean
  saved?: boolean
  onReact: (emoji: string) => void
  onAction: (action: RoomAction) => void
}) {
  const { isDark } = useTheme()
  const { width } = useWindowDimensions()
  if (deleted) return children
  return (
    <Host matchContents={{ vertical: true }} style={{ width }} colorScheme={isDark ? 'dark' : 'light'}>
      <ContextMenu>
        <ContextMenu.Items>
          {failed ? (
            <Button label="Retry send" systemImage="arrow.clockwise" onPress={() => onAction('retry')} />
          ) : (
            <>
              <Menu label="React" systemImage="face.smiling">
                {REACTIONS.map((emoji) => (
                  <Button key={emoji} label={emoji} onPress={() => onReact(emoji)} />
                ))}
              </Menu>
              <Button label="Reply" systemImage="arrowshape.turn.up.left" onPress={() => onAction('reply')} />
              <Button label="Reply in thread" systemImage="bubble.left.and.bubble.right" onPress={() => onAction('thread')} />
              <Button label="Copy" systemImage="doc.on.doc" onPress={() => onAction('copy')} />
              <Button label={pinned ? 'Unpin' : 'Pin'} systemImage={pinned ? 'pin.slash' : 'pin'} onPress={() => onAction('pin')} />
              <Button
                label={saved ? 'Remove from saved' : 'Save'}
                systemImage={saved ? 'bookmark.slash' : 'bookmark'}
                onPress={() => onAction('save')}
              />
              {mine ? (
                <>
                  <Button label="Edit" systemImage="pencil" onPress={() => onAction('edit')} />
                  <Button label="Delete" systemImage="trash" role="destructive" onPress={() => onAction('delete')} />
                </>
              ) : (
                <Button label="Report" systemImage="flag" role="destructive" onPress={() => onAction('report')} />
              )}
            </>
          )}
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <RNHostView matchContents>
            <View style={{ width }}>{children}</View>
          </RNHostView>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  )
}
