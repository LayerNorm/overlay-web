import React from 'react'
import { Pressable, View } from 'react-native'
import { Bookmark, Check, Copy, CornerDownRight, Flag, Pencil, Pin, RotateCcw, Smile, Star, ThumbsUp, Trash2 } from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import { T } from '../shell/primitives'

export type RoomAction = 'reply' | 'thread' | 'pin' | 'save' | 'copy' | 'edit' | 'delete' | 'retry' | 'report'
export function RoomMessageActions({ theme, mine, deleted = false, failed = false, pinned = false, saved = false, onReact, onAction }: { theme: Theme; mine: boolean; deleted?: boolean; failed?: boolean; pinned?: boolean; saved?: boolean; onReact: (emoji: string) => void; onAction: (action: RoomAction) => void }) {
  const actions: Array<[RoomAction, string, typeof Copy]> = failed ? [['retry', 'Retry send', RotateCcw]] : [
    ['thread', 'Reply in thread', CornerDownRight],
    ['reply', 'Reply', CornerDownRight], ['pin', pinned ? 'Unpin message' : 'Pin message', Pin], ['save', saved ? 'Remove from saved' : 'Save message', Bookmark], ['copy', 'Copy text', Copy],
    ...(mine ? [['edit', 'Edit message', Pencil], ['delete', 'Delete message', Trash2]] as Array<[RoomAction, string, typeof Copy]> : [['report', 'Report message', Flag]] as Array<[RoomAction, string, typeof Copy]>),
  ]
  return deleted ? <T style={{ color: theme.muted }}>Message deleted</T> : <View>
    {!failed ? <View style={{ flexDirection: 'row', gap: 12, paddingBottom: 12 }}>{([['👍', ThumbsUp], ['✅', Check], ['🙂', Smile], ['⭐', Star]] as const).map(([emoji, Icon]) => <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`React ${emoji}`} onPress={() => onReact(emoji)} style={{ width: 42, height: 38, alignItems: 'center', justifyContent: 'center' }}><Icon size={16} color={theme.muted} /></Pressable>)}</View> : null}
    {actions.map(([action, label, Icon]) => <Pressable key={action} accessibilityRole="button" onPress={() => onAction(action)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 8, borderRadius: 7, backgroundColor: pressed ? theme.surfaceSubtle : 'transparent' })}><Icon size={16} color={action === 'delete' ? theme.danger : theme.muted} /><T style={{ fontSize: 13, color: action === 'delete' ? theme.danger : theme.foreground }}>{label}</T></Pressable>)}
  </View>
}
