import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { spacing, fontSize, borderRadius } from '../../constants/theme'
import { Note, generateNoteId } from '../../services/types'
import { loadNote, saveNote } from '../../services/noteStorage'
import { useRichTextEditor } from '../../hooks/useRichTextEditor'

export default function NoteEditorScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { theme } = useTheme()

  const [noteTitle, setNoteTitle] = useState('Untitled')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const noteRef = useRef<Note | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleInputRef = useRef<TextInput>(null)

  const { editorComponent, getContent, setContent } = useRichTextEditor(theme)

  const performSave = useCallback(async (title: string, content: string) => {
    if (!noteRef.current) return
    setIsSaving(true)
    try {
      await saveNote({
        ...noteRef.current,
        title,
        content
      })
    } finally {
      setIsSaving(false)
    }
  }, [])

  const debouncedSave = useCallback((title: string, content: string) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      performSave(title, content)
    }, 500)
  }, [performSave])

  useEffect(() => {
    async function initNote(): Promise<void> {
      const noteId = id === 'new' ? generateNoteId() : id
      if (id === 'new') {
        const newNote: Note = {
          id: noteId,
          title: 'Untitled',
          content: '',
          updatedAt: Date.now(),
          createdAt: Date.now(),
          folderId: null
        }
        await saveNote(newNote)
        noteRef.current = newNote
        setNoteTitle('Untitled')
        setContent('')
        setIsLoading(false)
        setTimeout(() => {
          titleInputRef.current?.focus()
        }, 100)
      } else {
        const existing = await loadNote(noteId)
        if (existing) {
          noteRef.current = existing
          setNoteTitle(existing.title)
          setContent(existing.content)
        }
        setIsLoading(false)
      }
    }
    initNote()
  }, [id, setContent])

  const handleTitleChange = useCallback((text: string) => {
    setNoteTitle(text)
    const content = getContent()
    debouncedSave(text, content)
  }, [debouncedSave, getContent])

  const handleGoBack = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    const content = getContent()
    await performSave(noteTitle, content)
    router.back()
  }, [noteTitle, getContent, performSave, router])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={handleGoBack} style={styles.backButton} activeOpacity={0.7}>
          <Feather name="chevron-left" size={24} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          {isSaving && (
            <Text style={[styles.savingIndicator, { color: theme.textSecondary }]}>Saving...</Text>
          )}
        </View>

        <TouchableOpacity style={styles.headerAction} activeOpacity={0.7}>
          <Feather name="more-horizontal" size={20} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.editorContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <TextInput
          ref={titleInputRef}
          style={[styles.titleInput, { color: theme.text }]}
          value={noteTitle}
          onChangeText={handleTitleChange}
          placeholder="Untitled"
          placeholderTextColor={theme.textDisabled}
          returnKeyType="next"
          blurOnSubmit={true}
        />

        <View style={styles.editorWrapper}>
          {editorComponent}
        </View>
      </KeyboardAvoidingView>

      <TouchableOpacity
        style={[styles.voiceFab, { backgroundColor: theme.buttonBg }]}
        activeOpacity={0.7}
      >
        <Feather name="mic" size={22} color={theme.surface} />
      </TouchableOpacity>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1
  },
  backButton: {
    padding: spacing.sm,
    borderRadius: borderRadius.sm
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center'
  },
  savingIndicator: {
    fontSize: fontSize.xs
  },
  headerAction: {
    padding: spacing.sm,
    borderRadius: borderRadius.sm
  },
  editorContainer: {
    flex: 1
  },
  titleInput: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm
  },
  editorWrapper: {
    flex: 1,
    paddingHorizontal: spacing.lg
  },
  voiceFab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5
  }
})
