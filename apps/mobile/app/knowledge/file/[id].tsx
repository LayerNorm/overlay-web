import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../../constants/theme'
import { getKnowledgeFile, getKnowledgeFileContent, updateKnowledgeFile } from '../../../services/knowledgeService'
import type { KnowledgeFile } from '@overlay/app-core'

export default function FileDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { theme } = useTheme()
  const router = useRouter()
  const [file, setFile] = useState<KnowledgeFile | null>(null)
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const loadFile = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    try {
      const data = await getKnowledgeFile(id)
      setFile(data)
      if (data.content !== undefined) {
        setContent(data.content)
      } else if (!data.isStorageBacked) {
        try {
          const text = await getKnowledgeFileContent(id)
          setContent(text)
        } catch {
          setContent('')
        }
      }
    } catch {
      Alert.alert('Error', 'Could not load file')
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadFile()
  }, [loadFile])

  async function handleSave() {
    if (!id || !file) return
    setIsSaving(true)
    try {
      await updateKnowledgeFile(id, { content })
    } catch {
      Alert.alert('Error', 'Could not save file')
    } finally {
      setIsSaving(false)
    }
  }

  const isTextFile =
    file?.name.endsWith('.txt') ||
    file?.name.endsWith('.md') ||
    file?.name.endsWith('.json') ||
    file?.name.endsWith('.js') ||
    file?.name.endsWith('.ts') ||
    file?.name.endsWith('.tsx') ||
    file?.name.endsWith('.css') ||
    file?.name.endsWith('.html') ||
    file?.name.endsWith('.csv') ||
    false

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  if (!file) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <Text style={{ color: theme.textSecondary }}>File not found</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { borderColor: theme.border }]}>
          <Feather name="arrow-left" size={18} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
          {file.name}
        </Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={isSaving || !isTextFile}
          style={[styles.saveButton, { opacity: isSaving || !isTextFile ? 0.4 : 1 }]}
        >
          <Text style={[styles.saveButtonText, { color: theme.foreground }]}>{isSaving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      {isTextFile ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <TextInput
            value={content}
            onChangeText={setContent}
            multiline
            textAlignVertical="top"
            placeholder="Enter file content..."
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
        </ScrollView>
      ) : (
        <View style={styles.centered}>
          <Feather name="file" size={40} color={theme.textSecondary} />
          <Text style={[styles.binaryHint, { color: theme.textSecondary }]}>
            {file.isStorageBacked
              ? 'This file is stored externally and cannot be edited on mobile.'
              : 'This file type cannot be edited on mobile.'}
          </Text>
        </View>
      )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'LibreBaskerville',
    textAlign: 'center',
  },
  saveButton: {
    paddingHorizontal: 12,
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
  },
  editor: {
    flex: 1,
    minHeight: 400,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  binaryHint: {
    fontSize: fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
})
