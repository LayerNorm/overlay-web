import React from 'react'
import { Modal, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { T } from '../shell/primitives'

/**
 * The model picker as a native iOS page sheet: system presentation, swipe
 * down to dismiss, grabber, and a centred title with a close button like
 * the system's own sheets. The picker body (shared ModelSelector layout)
 * fills the sheet.
 */
export function ModelPickerSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const { theme, isDark } = useTheme()
  const { bottom } = useSafeAreaInsets()
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingBottom: bottom }}>
        <View style={{ alignItems: 'center', paddingTop: 6 }}>
          <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: isDark ? '#5A5A5E' : '#C7C7CC' }} />
        </View>
        <View style={{ height: 52, justifyContent: 'center', alignItems: 'center' }}>
          <T style={{ fontSize: 17, fontFamily: 'GeistSemibold', color: theme.foreground }}>Choose a model</T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => ({
              position: 'absolute',
              right: 16,
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isDark ? '#2C2C2E' : '#E9E9EB',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Image source="sf:xmark" style={{ width: 11, height: 11 }} contentFit="contain" tintColor={(isDark ? '#AEAEB2' : '#6C6C70') as string} />
          </Pressable>
        </View>
        <View style={{ flex: 1, paddingHorizontal: 16 }}>{children}</View>
      </View>
    </Modal>
  )
}
