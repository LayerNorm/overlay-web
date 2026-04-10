import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { getKnowledgeFile, updateKnowledgeFile } from '../../services/knowledgeService'

export default function FileScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { theme } = useTheme()
  const [name, setName] = useState('File')
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let isMounted = true
    void getKnowledgeFile(id)
      .then((file) => {
        if (!isMounted) return
        setName(file.name)
        setContent(file.content || '')
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [id])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      await updateKnowledgeFile(id, { content })
    } finally {
      setIsSaving(false)
    }
  }, [content, id])

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <Feather name="chevron-left" size={18} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>{name}</Text>
          <Text style={[styles.headerMeta, { color: theme.textSecondary }]}>Knowledge file</Text>
        </View>
        <TouchableOpacity onPress={() => void handleSave()} style={[styles.saveButton, { backgroundColor: theme.text }]}>
          <Text style={[styles.saveText, { color: theme.surface }]}>{isSaving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <TextInput
          multiline
          value={content}
          onChangeText={setContent}
          placeholder="File content"
          placeholderTextColor={theme.textDisabled}
          style={[
            styles.input,
            {
              color: theme.text,
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  headerMeta: {
    fontSize: fontSize.sm,
  },
  saveButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  saveText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  content: {
    padding: spacing.xl,
  },
  input: {
    minHeight: 420,
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    fontSize: fontSize.md,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
})
