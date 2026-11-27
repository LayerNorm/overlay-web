import React from 'react'
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'

// NOTE: For App Store compliance with Apple guidelines 3.1.1 / 3.1.3, this
// modal intentionally displays NO pricing and NO external checkout links.
// Premium plan management lives on the web; users who already have a paid
// plan continue to receive the matching entitlements when signed in.
// When StoreKit IAP or the External Link Account Entitlement is added,
// pricing UX can be restored from git history.

export function UpgradePrompt({
  visible,
  theme,
  onClose,
}: {
  visible: boolean
  theme: Theme
  onClose: () => void
}): React.ReactElement {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.scrim }]} onPress={onClose}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>Premium model</Text>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.8}
              style={[styles.closeButton, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="x" size={18} color={theme.text} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            This model is available on a paid Overlay plan. The free models
            in the picker are unlocked for everyone — pick one to keep chatting.
          </Text>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.cta, { backgroundColor: theme.text, opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={[styles.ctaText, { color: theme.background }]}>Got it</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    flex: 1,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 52,
    borderRadius: borderRadius.full,
    marginTop: 4,
  },
  ctaText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
})
