import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useVoiceInput } from '../../hooks/useVoiceInput'
import { useRichTextEditor } from '../../hooks/useRichTextEditor'
import { IconAction, MetricTile, PanelCard, SectionLabel } from '../../components/ui/PanelPrimitives'
import type { Note } from '../../services/types'
import { createNote, loadNote, saveNote } from '../../services/noteStorage'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeHtml(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) {
    return '<p></p>'
  }

  if (trimmed.startsWith('<')) {
    return trimmed
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('')
}

function stripHtml(content: string): string {
  return content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function appendParagraph(content: string, text: string): string {
  const nextParagraph = `<p>${escapeHtml(text)}</p>`
  const trimmed = content.trim()
  if (!trimmed || trimmed === '<p></p>') {
    return nextParagraph
  }
  return `${trimmed}${nextParagraph}`
}

export default function NoteEditorScreen(): React.ReactElement {
  const { id, projectId, projectName } = useLocalSearchParams<{
    id: string
    projectId?: string
    projectName?: string
  }>()
  const router = useRouter()
  const { theme } = useTheme()

  const [noteTitle, setNoteTitle] = useState('Untitled')
  const [editorHtml, setEditorHtml] = useState('<p></p>')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)

  const noteRef = useRef<Note | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleInputRef = useRef<TextInput>(null)

  const { isRecording, isProcessing, error: voiceError, toggleRecording } = useVoiceInput()

  const performSave = useCallback(async (title: string, content: string) => {
    if (!noteRef.current) return

    setIsSaving(true)

    try {
      const nextNote: Note = {
        ...noteRef.current,
        title: title.trim() || 'Untitled',
        content,
        updatedAt: Date.now(),
      }

      noteRef.current = nextNote
      await saveNote(nextNote)
      setLastSavedAt(Date.now())
    } finally {
      setIsSaving(false)
    }
  }, [])

  const scheduleSave = useCallback(
    (title: string, content: string) => {
      if (!noteRef.current) return
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      saveTimeoutRef.current = setTimeout(() => {
        void performSave(title, content)
      }, 450)
    },
    [performSave],
  )

  const { editorComponent, getContent, setContent } = useRichTextEditor(theme, {
    initialContent: editorHtml,
    onContentChange: (html) => {
      setEditorHtml(html)
      scheduleSave(noteTitle, html)
    },
  })

  useEffect(() => {
    let isMounted = true

    async function initializeNote(): Promise<void> {
      try {
        let activeNote: Note | null = null

        if (id === 'new') {
          activeNote = await createNote({
            title: 'Untitled',
            content: '<p></p>',
            projectId,
          })
          if (isMounted) {
            router.replace(`/note/${activeNote.id}`)
          }
        } else if (id) {
          activeNote = await loadNote(id)
        }

        if (!isMounted) return

        if (!activeNote) {
          router.back()
          return
        }

        const normalizedContent = normalizeHtml(activeNote.content)
        noteRef.current = {
          ...activeNote,
          content: normalizedContent,
        }
        setNoteTitle(activeNote.title || 'Untitled')
        setEditorHtml(normalizedContent)
        setContent(normalizedContent)
        setLastSavedAt(activeNote.updatedAt)
        setIsLoading(false)

        setTimeout(() => {
          titleInputRef.current?.focus()
        }, 120)
      } catch {
        if (isMounted) {
          setIsLoading(false)
          router.back()
        }
      }
    }

    void initializeNote()

    return () => {
      isMounted = false
    }
  }, [id, projectId, router, setContent])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const plainTextBody = useMemo(() => stripHtml(editorHtml), [editorHtml])

  const handleTitleChange = useCallback(
    (text: string) => {
      setNoteTitle(text)
      scheduleSave(text, getContent() || editorHtml)
    },
    [editorHtml, getContent, scheduleSave],
  )

  const handleVoiceToggle = useCallback(async () => {
    const result = await toggleRecording()
    if (!result?.text) return

    const nextContent = appendParagraph(getContent() || editorHtml, result.text)
    setEditorHtml(nextContent)
    setContent(nextContent)
    scheduleSave(noteTitle, nextContent)
  }, [editorHtml, getContent, noteTitle, scheduleSave, setContent, toggleRecording])

  const handleBack = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    await performSave(noteTitle, getContent() || editorHtml)
    router.back()
  }, [editorHtml, getContent, noteTitle, performSave, router])

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.loadingScreen, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.textSecondary} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.ambientGlow, styles.ambientGlowLeft, { backgroundColor: theme.surface }]} />
      <View style={[styles.ambientGlow, styles.ambientGlowRight, { backgroundColor: theme.surface }]} />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.screenPadding}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => {
                void handleBack()
              }}
              activeOpacity={0.82}
              style={[styles.backButton, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Feather name="chevron-left" size={20} color={theme.text} />
            </TouchableOpacity>

            <View style={styles.headerCopy}>
              <SectionLabel theme={theme}>Notebook</SectionLabel>
              <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
                {noteTitle || 'Untitled'}
              </Text>
              {projectName ? (
                <Text style={[styles.headerProject, { color: theme.textSecondary }]} numberOfLines={1}>
                  {projectName}
                </Text>
              ) : null}
            </View>

            <IconAction
              theme={theme}
              icon={isRecording ? 'square' : 'mic'}
              onPress={() => {
                void handleVoiceToggle()
              }}
              active={isRecording}
            />
          </View>

          <PanelCard theme={theme}>
            <View style={styles.heroCopy}>
              <Text style={[styles.heroTitle, { color: theme.text }]}>Server-backed notebook editor</Text>
              <Text style={[styles.heroDescription, { color: theme.textSecondary }]}>
                Notes autosave to the same Overlay document store used on the web app.
              </Text>
            </View>

            <View style={styles.metricRow}>
              <MetricTile
                theme={theme}
                label="Words"
                value={String(plainTextBody ? plainTextBody.split(/\s+/).length : 0)}
              />
              <MetricTile
                theme={theme}
                label="Status"
                value={isSaving ? 'Saving' : lastSavedAt ? 'Saved' : 'Draft'}
                accent={isSaving ? '#F59E0B' : undefined}
              />
            </View>

            {isRecording || isProcessing || voiceError ? (
              <View style={[styles.voiceBar, { backgroundColor: theme.background, borderColor: theme.border }]}>
                {isProcessing ? (
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                ) : (
                  <View style={styles.recordingDot} />
                )}
                <Text style={[styles.voiceBarText, { color: isRecording ? '#EF4444' : theme.textSecondary }]}>
                  {isRecording
                    ? 'Recording voice note…'
                    : isProcessing
                      ? 'Transcribing into the note…'
                      : voiceError}
                </Text>
              </View>
            ) : null}
          </PanelCard>

          <PanelCard theme={theme}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Title</Text>
            <TextInput
              ref={titleInputRef}
              value={noteTitle}
              onChangeText={handleTitleChange}
              placeholder="Untitled"
              placeholderTextColor={theme.textDisabled}
              style={[styles.titleInput, { color: theme.text }]}
            />
          </PanelCard>

          <View style={styles.editorShell}>
            <PanelCard theme={theme} padded={false}>
              <View style={[styles.editorHeader, { borderBottomColor: theme.border }]}>
                <Text style={[styles.editorHeaderText, { color: theme.text }]}>Body</Text>
                <Text style={[styles.editorHeaderMeta, { color: theme.textSecondary }]}>Rich text editor</Text>
              </View>
              <View style={styles.editorContent}>{editorComponent}</View>
            </PanelCard>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  ambientGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 999,
    opacity: 0.18,
  },
  ambientGlowLeft: {
    top: -60,
    left: -90,
  },
  ambientGlowRight: {
    top: 120,
    right: -100,
  },
  screenPadding: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    gap: 3,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  headerProject: {
    fontSize: fontSize.sm,
  },
  heroCopy: {
    gap: 6,
  },
  heroTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  heroDescription: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  voiceBar: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#EF4444',
  },
  voiceBarText: {
    fontSize: fontSize.sm,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: '700',
    paddingVertical: 2,
  },
  editorShell: {
    flex: 1,
    minHeight: 320,
  },
  editorHeader: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editorHeaderText: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  editorHeaderMeta: {
    fontSize: fontSize.sm,
  },
  editorContent: {
    minHeight: 360,
  },
})
