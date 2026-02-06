import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTheme } from '../../hooks/useTheme'
import { spacing, fontSize, borderRadius } from '../../constants/theme'

export default function HomeScreen(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()

  const handleNewChat = (): void => {
    router.push('/chats')
  }

  const handleNewNote = (): void => {
    router.push('/notes')
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <View style={[styles.logoCircle, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Feather name="sun" size={28} color={theme.text} />
          </View>
          <Text style={[styles.appName, { color: theme.text }]}>dawn</Text>
        </View>

        <View style={styles.startSection}>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>START</Text>

          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.surface }]}
              onPress={handleNewChat}
              activeOpacity={0.7}
            >
              <Feather name="message-square" size={20} color={theme.textSecondary} />
              <Text style={[styles.actionButtonText, { color: theme.text }]}>New Chat</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.surface }]}
              onPress={handleNewNote}
              activeOpacity={0.7}
            >
              <Feather name="file-text" size={20} color={theme.textSecondary} />
              <Text style={[styles.actionButtonText, { color: theme.text }]}>New Note</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: -60,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 40,
  },
  logoCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    fontFamily: 'Georgia',
    fontSize: fontSize.display,
    fontWeight: '400',
    letterSpacing: -0.5,
  },
  startSection: {
    gap: spacing.lg,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  actionButtons: {
    gap: spacing.xs,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
  },
  actionButtonText: {
    fontSize: fontSize.md,
    fontWeight: '400',
  },
})
