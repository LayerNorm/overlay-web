import React, { useCallback, useMemo, useState } from 'react'
import {
  Alert,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { IconAction, MetricTile, PanelCard, SectionLabel } from '../../components/ui/PanelPrimitives'
import { deleteNote, loadNotesIndex } from '../../services/noteStorage'
import type { NoteMeta } from '../../services/types'
import { formatDate, getDateLabel } from '../../services/types'

function withOpacity(color: string, opacity: number): string {
  if (!color.startsWith('#')) return color

  const hex = color.slice(1)
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex

  const value = Number.parseInt(normalized, 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

function getAccent(seed: string, isDark: boolean): {
  tint: string
  wash: string
  line: string
} {
  const accents = isDark
    ? [
        { tint: '#fde68a', wash: 'rgba(253, 230, 138, 0.14)', line: 'rgba(253, 230, 138, 0.34)' },
        { tint: '#a5f3fc', wash: 'rgba(165, 243, 252, 0.14)', line: 'rgba(165, 243, 252, 0.34)' },
        { tint: '#f9a8d4', wash: 'rgba(249, 168, 212, 0.14)', line: 'rgba(249, 168, 212, 0.34)' },
        { tint: '#c4b5fd', wash: 'rgba(196, 181, 253, 0.14)', line: 'rgba(196, 181, 253, 0.34)' },
      ]
    : [
        { tint: '#92400e', wash: 'rgba(146, 64, 14, 0.10)', line: 'rgba(146, 64, 14, 0.22)' },
        { tint: '#155e75', wash: 'rgba(21, 94, 117, 0.10)', line: 'rgba(21, 94, 117, 0.22)' },
        { tint: '#9d174d', wash: 'rgba(157, 23, 77, 0.10)', line: 'rgba(157, 23, 77, 0.22)' },
        { tint: '#5b21b6', wash: 'rgba(91, 33, 182, 0.10)', line: 'rgba(91, 33, 182, 0.22)' },
      ]

  const hash = seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return accents[hash % accents.length]
}

function getFreshnessLabel(timestamp: number): string {
  const diffHours = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60))

  if (diffHours <= 1) return 'Just edited'
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return 'Older'
}

function NoteRow({
  note,
  isDark,
  onPress,
  onDelete,
}: {
  note: NoteMeta
  isDark: boolean
  onPress: () => void
  onDelete: () => void
}): React.ReactElement {
  const { theme } = useTheme()
  const accent = getAccent(note.id, isDark)

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onDelete}
      activeOpacity={0.86}
      style={[styles.itemRow, { borderBottomColor: theme.border }]}
    >
      <View style={[styles.rowRail, { backgroundColor: accent.tint }]} />

      <View style={[styles.rowIconWrap, { backgroundColor: accent.wash, borderColor: accent.line }]}>
        <Feather name="file-text" size={16} color={accent.tint} />
      </View>

      <View style={styles.itemBody}>
        <View style={styles.itemTitleLine}>
          <Text style={[styles.itemTitle, { color: theme.text }]} numberOfLines={1}>
            {note.title || 'Untitled'}
          </Text>

          <View style={[styles.itemBadge, { backgroundColor: withOpacity(theme.text, isDark ? 0.12 : 0.05) }]}>
            <Text style={[styles.itemBadgeText, { color: theme.textSecondary }]}>
              {getFreshnessLabel(note.updatedAt)}
            </Text>
          </View>
        </View>

        <View style={styles.noteMetaRow}>
          <View style={[styles.metaPill, { backgroundColor: accent.wash, borderColor: accent.line }]}>
            <Text style={[styles.metaPillText, { color: accent.tint }]}>Synced note</Text>
          </View>
          <Text style={[styles.itemMeta, { color: theme.textSecondary }]}>
            Updated {formatDate(note.updatedAt)}
          </Text>
        </View>
      </View>

      <Feather name="chevron-right" size={18} color={theme.textDisabled} />
    </TouchableOpacity>
  )
}

export default function NotesScreen(): React.ReactElement {
  const router = useRouter()
  const { theme, isDark } = useTheme()

  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  const refreshData = useCallback(async () => {
    const nextNotes = await loadNotesIndex()
    setNotes(nextNotes.sort((a, b) => b.updatedAt - a.updatedAt))
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refreshData()
    }, [refreshData]),
  )

  const handleDeleteNote = useCallback(
    (note: NoteMeta) => {
      Alert.alert('Delete note', `Delete "${note.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteNote(note.id)
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            await refreshData()
          },
        },
      ])
    },
    [refreshData],
  )

  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return notes
    return notes.filter((note) => note.title.toLowerCase().includes(query))
  }, [notes, searchQuery])

  const sections = useMemo(() => {
    const groups: Record<string, NoteMeta[]> = {}

    for (const note of filteredNotes) {
      const label = getDateLabel(note.updatedAt)
      if (!groups[label]) groups[label] = []
      groups[label].push(note)
    }

    return Object.entries(groups).map(([title, data]) => ({ title, data }))
  }, [filteredNotes])

  const latestNote = notes[0]
  const recentNotesCount = notes.filter((note) => Date.now() - note.updatedAt < 7 * 24 * 60 * 60 * 1000).length
  const todayCount = notes.filter((note) => getDateLabel(note.updatedAt) === 'TODAY').length

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View
          style={[
            styles.backgroundOrb,
            styles.backgroundOrbPrimary,
            { backgroundColor: isDark ? 'rgba(253, 230, 138, 0.12)' : 'rgba(251, 191, 36, 0.12)' },
          ]}
        />
        <View
          style={[
            styles.backgroundOrb,
            styles.backgroundOrbSecondary,
            { backgroundColor: isDark ? 'rgba(165, 243, 252, 0.08)' : 'rgba(14, 165, 233, 0.10)' },
          ]}
        />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <View style={styles.topBar}>
              <View style={styles.titleBlock}>
                <Text style={[styles.eyebrow, { color: theme.textSecondary }]}>Writing Desk</Text>
                <Text style={[styles.title, { color: theme.text }]}>Notes</Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                  The mobile notebook now uses the same server-backed note store as the web app.
                </Text>
              </View>

              <View style={styles.topBarActions}>
                <IconAction
                  theme={theme}
                  icon={showSearch ? 'x' : 'search'}
                  onPress={() => setShowSearch((value) => !value)}
                  active={showSearch}
                />
                <TouchableOpacity
                  onPress={() => router.push('/note/new')}
                  activeOpacity={0.86}
                  style={[styles.primaryFab, { backgroundColor: theme.buttonBg }]}
                >
                  <Feather name="plus" size={18} color={theme.surface} />
                </TouchableOpacity>
              </View>
            </View>

            <PanelCard theme={theme}>
              <View
                style={[
                  styles.heroCard,
                  {
                    backgroundColor: isDark ? withOpacity('#fde68a', 0.08) : withOpacity('#fffbeb', 0.96),
                    borderColor: withOpacity(theme.text, isDark ? 0.16 : 0.06),
                  },
                ]}
              >
                <View style={styles.heroTopRow}>
                  <View style={styles.heroCopy}>
                    <View
                      style={[
                        styles.heroChip,
                        { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.75)' },
                      ]}
                    >
                      <Feather name="edit-3" size={13} color={theme.textSecondary} />
                      <Text style={[styles.heroChipText, { color: theme.textSecondary }]}>
                        {latestNote ? 'Synced notebook active' : 'Blank page ready'}
                      </Text>
                    </View>

                    <Text style={[styles.heroTitle, { color: theme.text }]}>A notebook that stays in sync</Text>
                    <Text style={[styles.heroDescription, { color: theme.textSecondary }]}>
                      Create, edit, and resume notes with the same backend documents used across Overlay.
                    </Text>
                  </View>

                  <View style={styles.heroActionRow}>
                    <TouchableOpacity
                      onPress={() => router.push('/note/new')}
                      activeOpacity={0.86}
                      style={[styles.heroPrimaryCta, { backgroundColor: theme.buttonBg }]}
                    >
                      <Text style={[styles.heroPrimaryCtaText, { color: theme.surface }]}>New note</Text>
                      <Feather name="arrow-up-right" size={16} color={theme.surface} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.metricRow}>
                  <MetricTile theme={theme} label="Notes" value={String(notes.length)} />
                  <MetricTile theme={theme} label="Recent" value={String(recentNotesCount)} />
                  <MetricTile theme={theme} label="Today" value={String(todayCount)} />
                </View>

                {latestNote ? (
                  <TouchableOpacity
                    onPress={() => router.push(`/note/${latestNote.id}`)}
                    activeOpacity={0.86}
                    style={[
                      styles.resumeCard,
                      {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.78)',
                        borderColor: withOpacity(theme.text, isDark ? 0.14 : 0.08),
                      },
                    ]}
                  >
                    <View style={[styles.resumeIconWrap, { backgroundColor: withOpacity(theme.text, isDark ? 0.12 : 0.05) }]}>
                      <Feather name="bookmark" size={16} color={theme.textSecondary} />
                    </View>

                    <View style={styles.resumeCopy}>
                      <Text style={[styles.resumeLabel, { color: theme.textSecondary }]}>Continue writing</Text>
                      <Text style={[styles.resumeTitle, { color: theme.text }]} numberOfLines={1}>
                        {latestNote.title || 'Untitled'}
                      </Text>
                      <Text style={[styles.resumeMeta, { color: theme.textSecondary }]}>
                        Synced note · Updated {formatDate(latestNote.updatedAt)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
              </View>
            </PanelCard>

            {showSearch ? (
              <PanelCard theme={theme} padded={false}>
                <View
                  style={[
                    styles.searchRow,
                    { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.45)' },
                  ]}
                >
                  <View style={[styles.searchIconWrap, { backgroundColor: withOpacity(theme.text, isDark ? 0.12 : 0.05) }]}>
                    <Feather name="search" size={16} color={theme.textSecondary} />
                  </View>
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search note titles"
                    placeholderTextColor={theme.textDisabled}
                    style={[styles.searchInput, { color: theme.text }]}
                    autoFocus
                  />
                  {searchQuery ? (
                    <Text style={[styles.searchCount, { color: theme.textSecondary }]}>{filteredNotes.length}</Text>
                  ) : null}
                </View>
              </PanelCard>
            ) : null}

            {filteredNotes.length === 0 ? (
              <PanelCard theme={theme}>
                <View style={styles.emptyState}>
                  <View style={[styles.emptyIcon, { backgroundColor: withOpacity(theme.text, isDark ? 0.10 : 0.05), borderColor: theme.border }]}>
                    <Feather name="file-plus" size={28} color={theme.textSecondary} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: theme.text }]}>
                    {notes.length === 0 ? 'No notes yet' : 'No matching notes'}
                  </Text>
                  <Text style={[styles.emptyDescription, { color: theme.textSecondary }]}>
                    {notes.length === 0
                      ? 'Create your first note to start the shared notebook history.'
                      : 'Try another title, or jump into your latest draft from the spotlight card above.'}
                  </Text>
                </View>
              </PanelCard>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.data.length > 0 ? (
            <View style={styles.sectionHeader}>
              <SectionLabel theme={theme}>{section.title}</SectionLabel>
            </View>
          ) : null
        }
        renderItem={({ item, section, index }) => (
          <PanelCard theme={theme} padded={false}>
            <NoteRow
              note={item}
              isDark={isDark}
              onPress={() => router.push(`/note/${item.id}`)}
              onDelete={() => handleDeleteNote(item)}
            />
            {index === section.data.length - 1 ? <View style={styles.lastRowSpacer} /> : null}
          </PanelCard>
        )}
        SectionSeparatorComponent={() => <View style={{ height: spacing.lg }} />}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 140,
  },
  backgroundOrb: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 250,
  },
  backgroundOrbPrimary: {
    top: -40,
    left: -70,
  },
  backgroundOrbSecondary: {
    top: 250,
    right: -90,
  },
  headerStack: {
    gap: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: fontSize.md,
    lineHeight: 22,
    maxWidth: 420,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  primaryFab: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heroTopRow: {
    gap: spacing.lg,
  },
  heroCopy: {
    gap: spacing.sm,
  },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  heroTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  heroDescription: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  heroActionRow: {
    flexDirection: 'row',
  },
  heroPrimaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: borderRadius.full,
  },
  heroPrimaryCtaText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  resumeCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  resumeIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeCopy: {
    flex: 1,
    gap: 3,
  },
  resumeLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  resumeTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  resumeMeta: {
    fontSize: fontSize.sm,
  },
  searchRow: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
  },
  searchCount: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  emptyDescription: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 320,
  },
  sectionHeader: {
    marginBottom: spacing.sm,
  },
  itemRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
  },
  rowRail: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 999,
  },
  rowIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: {
    flex: 1,
    gap: 6,
    paddingVertical: spacing.md,
  },
  itemTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  itemBadge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  itemBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  noteMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  metaPill: {
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metaPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  itemMeta: {
    fontSize: fontSize.sm,
  },
  lastRowSpacer: {
    height: spacing.xs,
  },
})
