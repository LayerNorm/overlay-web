import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../../../constants/theme'
import { listMemories, updateMemory } from '../../../../services/knowledgeService'
import type { MemoryRow } from '@overlay/app-core'

export default function MemoryDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { theme } = useTheme()
  const [memory, setMemory] = useState<MemoryRow | null>(null)
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const loadMemory = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    try {
      const all = await listMemories()
      const found = all.find((m) => m.memoryId === id)
      if (found) {
        setMemory(found)
        setContent(found.fullContent || found.content)
      }
    } catch {
      Alert.alert('Error', 'Could not load memory')
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadMemory()
  }, [loadMemory])

  async function handleSave() {
    if (!id) return
    setIsSaving(true)
    try {
      await updateMemory(id, content)
      Alert.alert('Saved', 'Memory updated')
    } catch {
      Alert.alert('Error', 'Could not save memory')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  if (!memory) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <Text style={{ color: theme.textSecondary }}>Memory not found</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Memory', headerLargeTitle: false }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button accessibilityLabel="Save" disabled={isSaving} onPress={handleSave}>
          {isSaving ? 'Saving…' : 'Save'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
      >
        <TextInput
          value={content}
          onChangeText={setContent}
          multiline
          textAlignVertical="top"
          placeholder="Memory content..."
          placeholderTextColor={theme.textDisabled}
          style={[
            styles.editor,
            {
              color: theme.text,
              backgroundColor: theme.surfaceMuted,
              borderColor: theme.border,
            },
          ]}
        />
        {memory.source ? (
          <Text style={[styles.source, { color: theme.textSecondary }]}>Source: {memory.source}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'LibreBaskerville',
    textAlign: 'center',
  },
  saveButtonInline: {
    paddingHorizontal: 8,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: spacing.md,
  },
  editor: {
    minHeight: 300,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  source: {
    fontSize: fontSize.sm,
  },
})
