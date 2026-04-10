import React, { useCallback, useMemo, useState } from 'react'
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
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { PanelCard, SectionLabel } from '../../components/ui/PanelPrimitives'
import { createKnowledgeFile } from '../../services/knowledgeService'
import {
  getProject,
  listProjectChats,
  listProjectFiles,
  listProjectNotes,
  listProjectSkills,
} from '../../services/projectsService'
import type {
  ConversationSummary,
  KnowledgeFile,
  NoteDoc,
  ProjectSummary,
  SkillSummary,
} from '../../services/appContracts'

type ProjectTab = 'overview' | 'chats' | 'notes' | 'files' | 'skills'

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function ProjectDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { theme } = useTheme()
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [chats, setChats] = useState<ConversationSummary[]>([])
  const [notes, setNotes] = useState<NoteDoc[]>([])
  const [files, setFiles] = useState<KnowledgeFile[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [activeTab, setActiveTab] = useState<ProjectTab>('overview')
  const [isLoading, setIsLoading] = useState(true)
  const [showFileComposer, setShowFileComposer] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const [nextProject, nextChats, nextNotes, nextFiles, nextSkills] = await Promise.all([
        getProject(id),
        listProjectChats(id).catch(() => []),
        listProjectNotes(id).catch(() => []),
        listProjectFiles(id).catch(() => []),
        listProjectSkills(id).catch(() => []),
      ])
      setProject(nextProject)
      setChats(nextChats)
      setNotes(nextNotes)
      setFiles(nextFiles)
      setSkills(nextSkills)
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const projectTabs: ProjectTab[] = ['overview', 'chats', 'notes', 'files', 'skills']

  const overviewMetrics = useMemo(
    () => [
      { label: 'Chats', value: String(chats.length) },
      { label: 'Notes', value: String(notes.length) },
      { label: 'Files', value: String(files.length) },
    ],
    [chats.length, files.length, notes.length],
  )

  const handleCreateFile = useCallback(async () => {
    if (!project || !fileName.trim() || isSaving) return
    setIsSaving(true)
    try {
      const created = await createKnowledgeFile({
        name: fileName.trim(),
        content: fileContent,
        projectId: project._id,
      })
      setFileName('')
      setFileContent('')
      setShowFileComposer(false)
      await refresh()
      router.push(`/file/${created.id}`)
    } finally {
      setIsSaving(false)
    }
  }, [fileContent, fileName, isSaving, project, refresh, router])

  if (isLoading || !project) {
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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
          <Feather name="chevron-left" size={18} color={theme.textSecondary} />
          <Text style={[styles.backText, { color: theme.textSecondary }]}>Projects</Text>
        </TouchableOpacity>

        <SectionLabel theme={theme}>Project</SectionLabel>
        <Text style={[styles.title, { color: theme.text }]}>{project.name}</Text>
        <Text style={[styles.description, { color: theme.textSecondary }]}>
          {project.description || project.instructions || 'Project workspace'}
        </Text>

        <PanelCard theme={theme}>
          <View style={styles.metricRow}>
            {overviewMetrics.map((metric) => (
              <View key={metric.label} style={[styles.metricCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
                <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>{metric.label}</Text>
                <Text style={[styles.metricValue, { color: theme.text }]}>{metric.value}</Text>
              </View>
            ))}
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: '/chat/[id]',
                  params: { id: 'new', projectId: project._id, projectName: project.name },
                })
              }
              style={[styles.primaryAction, { backgroundColor: theme.buttonBg }]}
            >
              <Text style={[styles.primaryActionText, { color: theme.surface }]}>New chat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: '/note/[id]',
                  params: { id: 'new', projectId: project._id, projectName: project.name },
                })
              }
              style={[styles.secondaryAction, { borderColor: theme.border }]}
            >
              <Text style={[styles.secondaryActionText, { color: theme.text }]}>New note</Text>
            </TouchableOpacity>
          </View>
        </PanelCard>

        <View style={[styles.segmented, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {projectTabs.map((tab) => {
            const active = tab === activeTab
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={[styles.segment, { backgroundColor: active ? theme.text : 'transparent' }]}
              >
                <Text style={[styles.segmentText, { color: active ? theme.surface : theme.textSecondary }]}>
                  {tab}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {activeTab === 'overview' ? (
          <PanelCard theme={theme}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Instructions</Text>
            <Text style={[styles.description, { color: theme.textSecondary }]}>
              {project.instructions || 'No project instructions yet.'}
            </Text>
            <Text style={[styles.caption, { color: theme.textDisabled }]}>
              Updated {formatTimestamp(project.updatedAt)}
            </Text>
          </PanelCard>
        ) : null}

        {activeTab === 'chats' ? (
          <PanelCard theme={theme} padded={false}>
            {chats.length > 0 ? (
              chats.map((chat, index) => (
                <TouchableOpacity
                  key={chat._id}
                  onPress={() => router.push(`/chat/${chat._id}`)}
                  style={[
                    styles.row,
                    { borderBottomColor: index === chats.length - 1 ? 'transparent' : theme.border },
                  ]}
                >
                  <Feather name="message-square" size={16} color={theme.textSecondary} />
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>{chat.title}</Text>
                    <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                      {chat.lastMode} · {formatTimestamp(chat.updatedAt)}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={theme.textDisabled} />
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Feather name="message-square" size={24} color={theme.textSecondary} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No chats yet</Text>
              </View>
            )}
          </PanelCard>
        ) : null}

        {activeTab === 'notes' ? (
          <PanelCard theme={theme} padded={false}>
            {notes.length > 0 ? (
              notes.map((note, index) => (
                <TouchableOpacity
                  key={note._id}
                  onPress={() => router.push(`/note/${note._id}`)}
                  style={[
                    styles.row,
                    { borderBottomColor: index === notes.length - 1 ? 'transparent' : theme.border },
                  ]}
                >
                  <Feather name="file-text" size={16} color={theme.textSecondary} />
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>{note.title}</Text>
                    <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                      Updated {formatTimestamp(note.updatedAt)}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={theme.textDisabled} />
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Feather name="file-text" size={24} color={theme.textSecondary} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No notes yet</Text>
              </View>
            )}
          </PanelCard>
        ) : null}

        {activeTab === 'files' ? (
          <>
            {showFileComposer ? (
              <PanelCard theme={theme}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>New project file</Text>
                <TextInput
                  value={fileName}
                  onChangeText={setFileName}
                  placeholder="brief.md"
                  placeholderTextColor={theme.textDisabled}
                  style={[
                    styles.searchInput,
                    { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
                  ]}
                />
                <TextInput
                  multiline
                  value={fileContent}
                  onChangeText={setFileContent}
                  placeholder="Initial file content"
                  placeholderTextColor={theme.textDisabled}
                  style={[
                    styles.multilineInput,
                    { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
                  ]}
                />
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    onPress={() => {
                      setShowFileComposer(false)
                      setFileName('')
                      setFileContent('')
                    }}
                    style={[styles.secondaryAction, { borderColor: theme.border }]}
                  >
                    <Text style={[styles.secondaryActionText, { color: theme.text }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => void handleCreateFile()} style={[styles.primaryAction, { backgroundColor: theme.buttonBg }]}>
                    <Text style={[styles.primaryActionText, { color: theme.surface }]}>
                      {isSaving ? 'Creating…' : 'Create file'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </PanelCard>
            ) : (
              <TouchableOpacity
                onPress={() => setShowFileComposer(true)}
                style={[styles.secondaryAction, styles.inlineButton, { borderColor: theme.border }]}
              >
                <Text style={[styles.secondaryActionText, { color: theme.text }]}>New file</Text>
              </TouchableOpacity>
            )}

            <PanelCard theme={theme} padded={false}>
              {files.length > 0 ? (
                files.map((file, index) => (
                  <TouchableOpacity
                    key={file._id}
                    onPress={() => file.type === 'file' && router.push(`/file/${file._id}`)}
                    style={[
                      styles.row,
                      { borderBottomColor: index === files.length - 1 ? 'transparent' : theme.border },
                    ]}
                  >
                    <Feather name={file.type === 'folder' ? 'folder' : 'file'} size={16} color={theme.textSecondary} />
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowTitle, { color: theme.text }]}>{file.name}</Text>
                      <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                        {file.type} · Updated {formatTimestamp(file.updatedAt)}
                      </Text>
                    </View>
                    {file.type === 'file' ? <Feather name="chevron-right" size={16} color={theme.textDisabled} /> : null}
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Feather name="file" size={24} color={theme.textSecondary} />
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>No files yet</Text>
                </View>
              )}
            </PanelCard>
          </>
        ) : null}

        {activeTab === 'skills' ? (
          <PanelCard theme={theme} padded={false}>
            {skills.length > 0 ? (
              skills.map((skill, index) => (
                <View
                  key={skill._id}
                  style={[
                    styles.row,
                    { borderBottomColor: index === skills.length - 1 ? 'transparent' : theme.border },
                  ]}
                >
                  <Feather name="zap" size={16} color={theme.textSecondary} />
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>{skill.name}</Text>
                    <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={2}>
                      {skill.description || skill.instructions}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Feather name="zap" size={24} color={theme.textSecondary} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No project skills yet</Text>
              </View>
            )}
          </PanelCard>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  backText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  description: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  caption: {
    fontSize: fontSize.xs,
    marginTop: spacing.md,
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    padding: spacing.md,
    gap: 4,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryAction: {
    minHeight: 42,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  secondaryAction: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineButton: {
    alignSelf: 'flex-start',
  },
  secondaryActionText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: 4,
    gap: 4,
    flexWrap: 'wrap',
  },
  segment: {
    borderRadius: borderRadius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  segmentText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  searchInput: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
  },
  multilineInput: {
    minHeight: 132,
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
})
