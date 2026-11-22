import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import { useAgentEyes } from '../../hooks/useAgentEyes'
import { Stack } from 'expo-router'
import { X } from 'lucide-react-native'
import { ConversationHeader } from '../navigation/nativeHeader'
import type { Theme } from '../../constants/theme'
import { OverlayMark } from '../shell/Brand'
import { T, IconButton } from '../shell/primitives'
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

const SUGGESTIONS = [
  { title: 'Plan my week', detail: 'around my top priorities', symbol: 'calendar' },
  { title: 'Draft an email', detail: 'to follow up on a meeting', symbol: 'envelope' },
  { title: 'Explore an idea', detail: 'and weigh the tradeoffs', symbol: 'lightbulb' },
  { title: 'Summarize', detail: 'a long document or thread', symbol: 'text.alignleft' },
]

/** New personal chat: the Overlay mark glancing around, a prompt, and suggestion cards above the composer. */
export function EmptyPersonalChat({ theme, onSuggest }: { theme: Theme; onSuggest: (text: string) => void }) {
  const eyes = useAgentEyes(true)
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 18, paddingHorizontal: 24 }}>
        <OverlayMark size={56} color={theme.foreground} eyeX={eyes.x} eyeY={eyes.y} />
        <T style={{ fontSize: 26, letterSpacing: -0.6, color: theme.foreground, fontFamily: 'GeistMedium' }}>What’s on your mind?</T>
      </View>
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingBottom: 10, alignItems: 'flex-start' }}
      >
        {SUGGESTIONS.map((item) => (
          <Pressable
            key={item.title}
            accessibilityRole="button"
            accessibilityLabel={`${item.title} ${item.detail}`}
            onPress={() => onSuggest(`${item.title} ${item.detail}`)}
            style={({ pressed }) => ({
              width: 160,
              padding: 14,
              gap: 10,
              borderRadius: 20,
              borderCurve: 'continuous',
              backgroundColor: pressed ? theme.surfaceMuted : theme.surfaceSubtle,
            })}
          >
            <Image source={`sf:${item.symbol}`} style={{ width: 18, height: 18 }} contentFit="contain" tintColor={theme.foreground as string} />
            <View style={{ gap: 2 }}>
              <T style={{ fontSize: 15, fontFamily: 'GeistSemibold', color: theme.foreground }}>{item.title}</T>
              <T numberOfLines={2} style={{ fontSize: 14, lineHeight: 19, color: theme.muted }}>{item.detail}</T>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}
