import React from 'react'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { X } from 'lucide-react-native'
import { ConversationHeader } from '../navigation/nativeHeader'
import type { Theme } from '../../constants/theme'
import { OverlayMark } from '../shell/Brand'
import { T, Button, IconButton } from '../shell/primitives'
import { BottomSheet } from '../ui/AppChrome'

export function ChatSheet({ modelPicker = false, ...props }: Omit<React.ComponentProps<typeof BottomSheet>, 'solid' | 'tall'> & { modelPicker?: boolean }) {
  return <BottomSheet {...props} solid tall={modelPicker} headerAction={<IconButton icon={X} label="Close" theme={props.theme} onPress={props.onClose} />} />
}

/** Native navigation bar for a conversation; actions sit in the trailing toolbar. */
export function ChatHeader({ title, subtitle, onNew, onOptions }: { theme: Theme; title: string; subtitle?: string; busy?: boolean; topInset?: number; onDrawer?: () => void; onNew?: () => void; onOptions?: () => void; onBack?: () => void }) {
  return (
    <ConversationHeader title={title} subtitle={subtitle}>
      {onNew ? <Stack.Toolbar.Button icon="square.and.pencil" accessibilityLabel="New chat" onPress={onNew} /> : null}
      {onOptions ? <Stack.Toolbar.Button icon="ellipsis" accessibilityLabel="More options" onPress={onOptions} /> : null}
    </ConversationHeader>
  )
}

export function EmptyPersonalChat({ theme, onSuggest }: { theme: Theme; onSuggest: (text: string) => void }) {
  return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20, paddingHorizontal: 24, paddingBottom: 24 }}><OverlayMark size={36} color={theme.foreground} /><T style={{ fontSize: 26, color: theme.foreground, fontFamily: 'GeistMedium' }}>What’s on your mind?</T><View style={{ flexDirection: 'row', gap: 8 }}>{['Make a plan', 'Explore an idea'].map(text => <Button key={text} theme={theme} secondary onPress={() => onSuggest(text)}>{text}</Button>)}</View></View>
}
