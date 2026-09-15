import React, { useCallback, useMemo, useState } from 'react'
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import type { ConversationSummary, KnowledgeFile, NoteDoc, ProjectSummary, SkillSummary } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { ShareSheet } from '../workspace/ShareSheet'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { BottomSheet, EmptyState, MainScreenHeader, SegmentedControl, TopBarIconButton } from '../ui/AppChrome'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { FeatureGate } from '../ui/FeatureGate'
import {
  createProject,
  deleteProject,
  listProjectChats,
  listProjectFiles,
  listProjectNotes,
  listProjectSkills,
  listProjects,
  updateProject,
} from '../../services/projectsService'

type ProjectTab = 'chats' | 'notes' | 'files' | 'skills'

export function ProjectsScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()
  const { isFeatureEnabled } = useAppSession()
  const { activeWorkspaceId, workspacesEnabled } = useWorkspace()
  const sharingEnabled = workspacesEnabled && isFeatureEnabled('resourceSharing') && !!activeWorkspaceId
  const [shareOpen, setShareOpen] = useState(false)
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selected, setSelected] = useState<ProjectSummary | null>(null)
  const [tab, setTab] = useState<ProjectTab>('chats')
  const [chats, setChats] = useState<ConversationSummary[]>([])
  const [notes, setNotes] = useState<NoteDoc[]>([])
  const [files, setFiles] = useState<KnowledgeFile[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await listProjects()
      setProjects(rows)
      setSelected((current) => current ? rows.find((row) => row._id === current._id) ?? rows[0] ?? null : rows[0] ?? null)
    } catch (error) {
      Alert.alert('Projects unavailable', error instanceof Error ? error.message : 'Could not load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void loadProjects() }, [loadProjects]))

  const loadDetails = useCallback(async (project: ProjectSummary | null) => {
    if (!project) {
      setChats([])
      setNotes([])
      setFiles([])
      setSkills([])
      return
    }
    setDetailsLoading(true)
    try {
      const [nextChats, nextNotes, nextFiles, nextSkills] = await Promise.all([
        listProjectChats(project._id),
        listProjectNotes(project._id),
        listProjectFiles(project._id),
        listProjectSkills(project._id),
      ])
      setChats(nextChats)
      setNotes(nextNotes)
      setFiles(nextFiles)
      setSkills(nextSkills)
    } catch {
      setChats([])
      setNotes([])
      setFiles([])
      setSkills([])
    } finally {
      setDetailsLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void loadDetails(selected) }, [loadDetails, selected]))

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [projects],
  )

  function openCreate(): void {
    setSelected(null)
    setName('')
    setInstructions('')
    setEditorOpen(true)
  }

  function openEdit(project: ProjectSummary): void {
    setSelected(project)
    setName(project.name)
    setInstructions(project.instructions || '')
    setEditorOpen(true)
  }

  async function saveProject(): Promise<void> {
    const cleanName = name.trim()
    if (!cleanName) {
      Alert.alert('Name required', 'Projects need a name.')
      return
    }
    try {
      if (selected) {
        await updateProject(selected._id, { name: cleanName, instructions })
      } else {
        const created = await createProject({ name: cleanName, instructions })
        setSelected(created.project)
      }
      setEditorOpen(false)
      await loadProjects()
    } catch (error) {
      Alert.alert('Could not save project', error instanceof Error ? error.message : 'Try again.')
    }
  }

  function confirmDelete(project: ProjectSummary): void {
    Alert.alert('Delete project', `Delete ${project.name}? Project chats, notes, and files may be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteProject(project._id)
            if (selected?._id === project._id) setSelected(null)
            await loadProjects()
          } catch (error) {
            Alert.alert('Could not delete project', error instanceof Error ? error.message : 'Try again.')
          }
        },
      },
    ])
  }

  const renderProjectDetails = (): React.ReactNode => {
    if (!selected) return <EmptyState theme={theme} icon="folder" title="No project selected" description="Create or select a project to see its workspace." />
    if (detailsLoading) return <ActivityIndicator color={theme.textSecondary} />
    if (tab === 'chats') return chats.length ? chats.map((chat) => <Row key={chat._id} theme={theme} icon="message-square" title={chat.title} detail={new Date(chat.updatedAt).toLocaleDateString()} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat._id, projectId: selected._id, projectName: selected.name } })} />) : <EmptyState theme={theme} icon="message-square" title="No chats" description="Project chats appear here." />
    if (tab === 'notes') return notes.length ? notes.map((note) => <Row key={note._id} theme={theme} icon="book-open" title={note.title || 'Untitled'} detail={new Date(note.updatedAt).toLocaleDateString()} onPress={() => router.push({ pathname: '/note/[id]', params: { id: note._id, projectId: selected._id } })} />) : <EmptyState theme={theme} icon="book-open" title="No notes" description="Project notes appear here." />
    if (tab === 'files') return files.length ? files.map((file) => <Row key={file._id} theme={theme} icon={file.type === 'folder' ? 'folder' : 'file'} title={file.name} detail={file.type} onPress={() => file.type === 'file' ? router.push(`/(tabs)/knowledge/file/${encodeURIComponent(file._id)}`) : undefined} />) : <EmptyState theme={theme} icon="file" title="No files" description="Project files appear here." />
    return skills.length ? skills.map((skill) => <Row key={skill._id} theme={theme} icon="terminal" title={skill.name} detail={skill.enabled === false ? 'Disabled' : 'Enabled'} />) : <EmptyState theme={theme} icon="terminal" title="No skills" description="Project skills appear here." />
  }

  if (!isFeatureEnabled('projects')) {
    return <FeatureGate title="Projects are turned off" />
  }

  return (
    <ScreenWithDrawer drawer={<DrawerSidebar variant="slide" theme={theme} chats={[]} activeChatId={null} onSelectChat={() => {}} onCreateChat={() => {}} />}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
        <MainScreenHeader
          theme={theme}
          isDark={isDark}
          topInset={insets.top}
          blurHeight={insets.top + 56}
          leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />}
          centerSlot={<Text style={[styles.headerTitle, { color: theme.text }]}>Projects</Text>}
          rightSlot={<TopBarIconButton theme={theme} icon="plus" onPress={openCreate} />}
        />
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 72 }]}>
          {loading ? <ActivityIndicator color={theme.textSecondary} /> : sortedProjects.length === 0 ? (
            <EmptyState theme={theme} icon="folder" title="No projects" description="Create a project to group chats, notes, files, and skills." />
          ) : (
            <View style={styles.projectList}>
              {sortedProjects.map((project) => {
                const active = selected?._id === project._id
                return (
                  <TouchableOpacity key={project._id} onPress={() => setSelected(project)} onLongPress={() => openEdit(project)} activeOpacity={0.82} style={[styles.projectChip, { backgroundColor: active ? theme.foreground : theme.surfaceElevated, borderColor: theme.border }]}>
                    <Text style={[styles.projectChipText, { color: active ? theme.background : theme.text }]} numberOfLines={1}>{project.name}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          )}
          {selected ? (
            <View style={[styles.detailCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              <View style={styles.detailHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.detailTitle, { color: theme.text }]}>{selected.name}</Text>
                  {selected.instructions ? <Text style={[styles.detailCopy, { color: theme.textSecondary }]} numberOfLines={2}>{selected.instructions}</Text> : null}
                </View>
                {sharingEnabled ? (
                  <TouchableOpacity onPress={() => setShareOpen(true)}><Feather name="share-2" size={16} color={theme.textSecondary} /></TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => openEdit(selected)}><Feather name="edit-2" size={16} color={theme.textSecondary} /></TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDelete(selected)}><Feather name="trash-2" size={16} color="#EF4444" /></TouchableOpacity>
              </View>
              <SegmentedControl theme={theme} value={tab} onChange={setTab} options={[{ label: 'Chats', value: 'chats' }, { label: 'Notes', value: 'notes' }, { label: 'Files', value: 'files' }, { label: 'Skills', value: 'skills' }]} />
              <View style={styles.detailRows}>{renderProjectDetails()}</View>
            </View>
          ) : null}
        </ScrollView>
        <BottomSheet theme={theme} visible={editorOpen} onClose={() => setEditorOpen(false)} title={selected ? 'Edit Project' : 'New Project'}>
          <View style={styles.form}>
            <TextInput value={name} onChangeText={setName} placeholder="Project name" placeholderTextColor={theme.textDisabled} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <TextInput value={instructions} onChangeText={setInstructions} placeholder="Project instructions" placeholderTextColor={theme.textDisabled} multiline style={[styles.textArea, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <TouchableOpacity onPress={() => { void saveProject() }} style={[styles.primaryButton, { backgroundColor: theme.foreground }]}>
              <Text style={[styles.primaryButtonText, { color: theme.background }]}>Save</Text>
            </TouchableOpacity>
          </View>
        </BottomSheet>
        <ShareSheet
          visible={shareOpen}
          theme={theme}
          resource={
            selected && activeWorkspaceId
              ? { workspaceId: activeWorkspaceId, resourceType: 'project', resourceId: selected._id }
              : null
          }
          resourceTitle={selected?.name ?? ''}
          onClose={() => setShareOpen(false)}
        />
      </SafeAreaView>
    </ScreenWithDrawer>
  )
}

function Row({ theme, icon, title, detail, onPress }: { theme: ReturnType<typeof useTheme>['theme']; icon: keyof typeof Feather.glyphMap; title: string; detail?: string; onPress?: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} disabled={!onPress} style={[styles.row, { borderColor: theme.border }]}>
      <Feather name={icon} size={16} color={theme.textSecondary} />
      <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>{title}</Text>
      {detail ? <Text style={[styles.rowDetail, { color: theme.textSecondary }]} numberOfLines={1}>{detail}</Text> : null}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: { fontSize: fontSize.md, fontWeight: '700', textAlign: 'center' },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  projectList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  projectChip: { maxWidth: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: 9 },
  projectChipText: { fontSize: fontSize.sm, fontWeight: '700' },
  detailCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.xl, padding: spacing.md, gap: spacing.md },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  detailTitle: { fontSize: fontSize.lg, fontWeight: '700' },
  detailCopy: { marginTop: 4, fontSize: fontSize.sm, lineHeight: 20 },
  detailRows: { gap: spacing.sm },
  row: { minHeight: 46, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '600' },
  rowDetail: { maxWidth: 120, fontSize: fontSize.sm },
  form: { gap: spacing.md },
  input: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, fontSize: fontSize.md },
  textArea: { minHeight: 120, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md, fontSize: fontSize.md, textAlignVertical: 'top' },
  primaryButton: { minHeight: 46, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: fontSize.md, fontWeight: '700' },
})
