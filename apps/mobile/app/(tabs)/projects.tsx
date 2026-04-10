import React, { useCallback, useMemo, useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { IconAction, PanelCard, SectionLabel } from '../../components/ui/PanelPrimitives'
import { createProject, listProjects } from '../../services/projectsService'
import type { ProjectSummary } from '../../services/appContracts'

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function ProjectsScreen(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showComposer, setShowComposer] = useState(false)
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const refresh = useCallback(async () => {
    const nextProjects = await listProjects().catch(() => [])
    setProjects(nextProjects)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return projects
    return projects.filter((project) =>
      `${project.name} ${project.description || ''} ${project.instructions || ''}`.toLowerCase().includes(query),
    )
  }, [projects, searchQuery])

  const handleCreate = useCallback(async () => {
    if (!name.trim() || isSaving) return
    setIsSaving(true)
    try {
      const created = await createProject({
        name: name.trim(),
        instructions: instructions.trim() || undefined,
      })
      setName('')
      setInstructions('')
      setShowComposer(false)
      await refresh()
      router.push(`/project/${created.id}`)
    } finally {
      setIsSaving(false)
    }
  }, [instructions, isSaving, name, refresh, router])

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={styles.titleBlock}>
            <SectionLabel theme={theme}>Projects</SectionLabel>
            <Text style={[styles.title, { color: theme.text }]}>Project Spaces</Text>
            <Text style={[styles.description, { color: theme.textSecondary }]}>
              Project-scoped chat, notes, files, and skills now share the same server-side model as web.
            </Text>
          </View>
          <IconAction theme={theme} icon="plus" onPress={() => setShowComposer((current) => !current)} active={showComposer} />
        </View>

        <PanelCard theme={theme}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search projects"
            placeholderTextColor={theme.textDisabled}
            style={[
              styles.searchInput,
              { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
            ]}
          />
        </PanelCard>

        {showComposer ? (
          <PanelCard theme={theme}>
            <Text style={[styles.composerTitle, { color: theme.text }]}>New project</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Project name"
              placeholderTextColor={theme.textDisabled}
              style={[
                styles.searchInput,
                { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
              ]}
            />
            <TextInput
              multiline
              value={instructions}
              onChangeText={setInstructions}
              placeholder="Optional project instructions"
              placeholderTextColor={theme.textDisabled}
              style={[
                styles.multilineInput,
                { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
              ]}
            />
            <View style={styles.inlineActions}>
              <TouchableOpacity
                onPress={() => {
                  setShowComposer(false)
                  setName('')
                  setInstructions('')
                }}
                style={[styles.secondaryButton, { borderColor: theme.border }]}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void handleCreate()} style={[styles.primaryButton, { backgroundColor: theme.buttonBg }]}>
                <Text style={[styles.primaryButtonText, { color: theme.surface }]}>
                  {isSaving ? 'Creating…' : 'Create Project'}
                </Text>
              </TouchableOpacity>
            </View>
          </PanelCard>
        ) : null}

        <PanelCard theme={theme} padded={false}>
          {filteredProjects.length > 0 ? (
            filteredProjects.map((project, index) => (
              <TouchableOpacity
                key={project._id}
                onPress={() => router.push(`/project/${project._id}`)}
                style={[
                  styles.row,
                  { borderBottomColor: index === filteredProjects.length - 1 ? 'transparent' : theme.border },
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: theme.background }]}>
                  <Feather name="folder" size={16} color={theme.textSecondary} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={[styles.rowTitle, { color: theme.text }]}>{project.name}</Text>
                  <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={2}>
                    {project.description || project.instructions || 'Project workspace'}
                  </Text>
                  <Text style={[styles.rowCaption, { color: theme.textDisabled }]}>
                    Updated {formatTimestamp(project.updatedAt)}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color={theme.textDisabled} />
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Feather name="folder" size={24} color={theme.textSecondary} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No projects yet</Text>
              <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>
                Create a project to group chat, notes, files, and skills under one scope.
              </Text>
            </View>
          )}
        </PanelCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  description: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  searchInput: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.md,
  },
  composerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  multilineInput: {
    minHeight: 120,
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  inlineActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryButton: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  primaryButton: {
    minHeight: 42,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
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
    lineHeight: 20,
  },
  rowCaption: {
    fontSize: fontSize.xs,
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
  emptyCopy: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
})
