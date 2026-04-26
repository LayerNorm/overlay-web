import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { loadNote, saveNote, deleteNote } from '../../services/noteStorage'
import type { Note } from '../../services/types'

const SAVE_DEBOUNCE_MS = 1200

export function NoteEditor({ noteId }: { noteId: string }): React.ReactElement {
  const router = useRouter()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()

  const [note, setNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef<{ title: string; content: string }>({ title: '', content: '' })

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const loaded = await loadNote(noteId)
      if (loaded) {
        setNote(loaded)
        setTitle(loaded.title)
        setContent(stripHtml(loaded.content))
        lastSavedRef.current = { title: loaded.title, content: stripHtml(loaded.content) }
      } else {
        Alert.alert('Not found', 'This note could not be found.', [
          { text: 'OK', onPress: () => router.back() },
        ])
      }
    } catch {
      Alert.alert('Error', 'Could not load note.')
    } finally {
      setIsLoading(false)
    }
  }, [noteId, router])

  useEffect(() => {
    void load()
  }, [load])

  const performSave = useCallback(async (currentTitle: string, currentContent: string) => {
    if (!note) return
    setIsSaving(true)
    try {
      await saveNote({
        ...note,
        title: currentTitle,
        content: currentContent,
      })
      lastSavedRef.current = { title: currentTitle, content: currentContent }
      setHasChanges(false)
    } catch {
      // ignore — will remain dirty and retry next keystroke
    } finally {
      setIsSaving(false)
    }
  }, [note])

  const queueSave = useCallback(
    (nextTitle: string, nextContent: string) => {
      const titleChanged = nextTitle !== lastSavedRef.current.title
      const contentChanged = nextContent !== lastSavedRef.current.content
      setHasChanges(titleChanged || contentChanged)

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = setTimeout(() => {
        void performSave(nextTitle, nextContent)
      }, SAVE_DEBOUNCE_MS)
    },
    [performSave],
  )

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitle(text)
      queueSave(text, content)
    },
    [content, queueSave],
  )

  const handleContentChange = useCallback(
    (text: string) => {
      setContent(text)
      queueSave(title, text)
    },
    [title, queueSave],
  )

  const handleDelete = useCallback(() => {
    Alert.alert('Delete note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNote(noteId)
            router.back()
          } catch {
            Alert.alert('Error', 'Could not delete note')
          }
        },
      },
    ])
  }, [noteId, router])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}
      >
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
            <Feather name="arrow-left" size={20} color={theme.text} />
          </TouchableOpacity>

          <View style={styles.headerMeta}>
            {isSaving ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : hasChanges ? (
              <Text style={[styles.unsavedLabel, { color: theme.textSecondary }]}>Unsaved</Text>
            ) : (
              <Feather name="check" size={16} color={theme.textSecondary} />
            )}
          </View>

          <TouchableOpacity onPress={handleDelete} style={styles.headerButton}>
            <Feather name="trash-2" size={18} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            value={title}
            onChangeText={handleTitleChange}
            placeholder="Note title"
            placeholderTextColor={theme.textDisabled}
            style={[styles.titleInput, { color: theme.text }]}
            maxLength={200}
          />

          <TextInput
            value={content}
            onChangeText={handleContentChange}
            placeholder="Start writing..."
            placeholderTextColor={theme.textDisabled}
            multiline
            textAlignVertical="top"
            style={[styles.contentInput, { color: theme.text }]}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function stripHtml(html: string): string {
  if (!html) return ''
  // Basic HTML tag stripping for mobile plain-text editing
  return html
    .replace(/<\/?p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMeta: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unsavedLabel: {
    fontSize: fontSize.sm,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  titleInput: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
    fontFamily: 'LibreBaskerville',
    paddingVertical: 0,
  },
  contentInput: {
    flex: 1,
    minHeight: 200,
    fontSize: fontSize.md,
    lineHeight: 26,
    paddingVertical: 0,
  },
})
