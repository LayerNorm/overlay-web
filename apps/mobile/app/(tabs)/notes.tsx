import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { spacing, fontSize, borderRadius } from '../../constants/theme'

export default function NotesScreen(): React.ReactElement {
  const { theme } = useTheme()

  const handleNewNote = (): void => {
    // TODO: Implement new note creation in Phase 2
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Notes</Text>
        <TouchableOpacity
          style={[styles.newButton, { backgroundColor: theme.buttonBg }]}
          onPress={handleNewNote}
          activeOpacity={0.7}
        >
          <Feather name="plus" size={20} color={theme.surface} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.surface }]}>
            <Feather name="file-text" size={32} color={theme.textSecondary} />
          </View>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>No notes yet</Text>
          <Text style={[styles.emptyDescription, { color: theme.textSecondary }]}>
            Create your first note to get started
          </Text>
          <TouchableOpacity
            style={[styles.emptyButton, { backgroundColor: theme.buttonBg }]}
            onPress={handleNewNote}
            activeOpacity={0.7}
          >
            <Text style={[styles.emptyButtonText, { color: theme.surface }]}>New Note</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '600',
  },
  newButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  emptyDescription: {
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  emptyButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    marginTop: spacing.md,
  },
  emptyButtonText: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
})
