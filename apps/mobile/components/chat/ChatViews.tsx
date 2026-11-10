import React from 'react'
import { ActivityIndicator, View } from 'react-native'
import { ChevronLeft, MoreHorizontal, PanelLeft, SquarePen, X } from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import { OverlayMark } from '../shell/Brand'
import { T, Button, IconButton } from '../shell/primitives'
import { BottomSheet } from '../ui/AppChrome'

export function ChatSheet({ modelPicker = false, ...props }: Omit<React.ComponentProps<typeof BottomSheet>, 'solid' | 'tall'> & { modelPicker?: boolean }) {
  return <BottomSheet {...props} solid tall={modelPicker} headerAction={<IconButton icon={X} label="Close" theme={props.theme} onPress={props.onClose} />} />
}

export function ChatHeader({ theme, title, subtitle, busy = false, topInset = 0, onDrawer, onNew, onOptions, onBack }: { theme: Theme; title: string; subtitle?: string; busy?: boolean; topInset?: number; onDrawer: () => void; onNew?: () => void; onOptions?: () => void; onBack?: () => void }) {
  return <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingTop: topInset, backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border }}><View style={{ height: 58, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12 }}>
    <IconButton icon={onBack ? ChevronLeft : PanelLeft} label={onBack ? 'Back' : 'Open navigation menu'} theme={theme} onPress={onBack ?? onDrawer} />
    <View style={{ flex: 1, gap: 3 }}><View style={{ flexDirection: 'row', gap: 5 }}><T style={{ color: theme.muted, fontSize: 11 }}>Workspace › Chats ›</T><T numberOfLines={1} style={{ color: theme.foreground, fontSize: 11, flex: 1 }}>{title}</T></View>{subtitle ? <T numberOfLines={1} style={{ color: theme.muted, fontSize: 10 }}>{subtitle}</T> : null}</View>
    {busy ? <ActivityIndicator size="small" color={theme.muted} /> : null}
    {onNew ? <IconButton icon={SquarePen} label="New chat" theme={theme} onPress={onNew} /> : null}
    {onOptions ? <IconButton icon={MoreHorizontal} label="More options" theme={theme} onPress={onOptions} /> : null}
  </View></View>
}

export function EmptyPersonalChat({ theme, onSuggest }: { theme: Theme; onSuggest: (text: string) => void }) {
  return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20, paddingHorizontal: 24, paddingBottom: 24 }}><OverlayMark size={36} color={theme.foreground} /><T style={{ fontSize: 26, color: theme.foreground, fontFamily: 'GeistMedium' }}>What’s on your mind?</T><View style={{ flexDirection: 'row', gap: 8 }}>{['Make a plan', 'Explore an idea'].map(text => <Button key={text} theme={theme} secondary onPress={() => onSuggest(text)}>{text}</Button>)}</View></View>
}
