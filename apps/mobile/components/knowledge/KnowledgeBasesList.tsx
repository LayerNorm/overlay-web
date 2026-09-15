/**
 * Knowledge bases tab — list of curated bases (personal + organization) with
 * a personal-brain shortcut (`ensurePersonal`), search filter, create sheet,
 * and routing into `/knowledge-base/[id]`. Mirrors web `/app/knowledge`.
 */
import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import type { KnowledgeBase } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import {
  createKnowledgeBase,
  ensurePersonalKnowledgeBase,
  listKnowledgeBases,
} from '../../services/knowledgeBasesService'
import { BottomSheet, EmptyState, SearchField, SegmentedControl } from '../ui/AppChrome'
import { Badge, ListRow, Section } from '../ui/primitives'

export function KnowledgeBasesList({ topInset = 0 }: { topInset?: number }): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<'personal' | 'organization'>('organization')

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true)
    else setLoading(true)
    try {
      setBases(await listKnowledgeBases())
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load knowledge bases')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const filtered = bases.filter((base) =>
    !query.trim() || `${base.title} ${base.description ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const openPersonal = async (): Promise<void> => {
    setBusy(true)
    try {
      const personal = await ensurePersonalKnowledgeBase()
      router.push({ pathname: '/knowledge-base/[id]', params: { id: personal.id } })
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open personal base')
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = async (): Promise<void> => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      const base = await createKnowledgeBase({
        title: title.trim(),
        description: description.trim() || undefined,
        kind,
      })
      setCreateOpen(false)
      setTitle('')
      setDescription('')
      router.push({ pathname: '/knowledge-base/[id]', params: { id: base.id } })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create knowledge base')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topInset }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={theme.textSecondary}
          />
        }
      >
        <SearchField
          theme={theme}
          value={query}
          onChangeText={setQuery}
          placeholder="Search knowledge bases"
        />
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setCreateOpen(true)}
          style={[styles.newButton, { backgroundColor: theme.foreground }]}
        >
          <Text style={[styles.newButtonText, { color: theme.background }]}>New knowledge base</Text>
        </TouchableOpacity>

        {error ? <Text style={[styles.errorText, { color: '#EF4444' }]}>{error}</Text> : null}

        <Section theme={theme} label="Personal">
          <ListRow
            theme={theme}
            icon="book-open"
            iconSfSymbol="brain"
            title="Personal knowledge base"
            subtitle="Your private, always-available retrieval corpus"
            showChevron
            accessory={busy ? <ActivityIndicator size="small" color={theme.textSecondary} /> : undefined}
            onPress={() => void openPersonal()}
          />
        </Section>

        {loading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : filtered.length === 0 ? (
          <EmptyState
            theme={theme}
            icon="database"
            title={query ? 'No matching bases' : 'No knowledge bases yet'}
            description="Curated collections of documents you can search and cite in chats."
          />
        ) : (
          <Section theme={theme} label="All bases">
            {filtered.map((base) => (
              <ListRow
                key={base.id}
                theme={theme}
                icon="database"
                iconSfSymbol="cylinder"
                title={base.title}
                subtitle={[
                  base.description ?? '',
                  `updated ${new Date(base.updatedAt).toLocaleDateString()}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                accessory={
                  <View style={styles.rowTrailing}>
                    {base.kind === 'organization' ? (
                      <Badge theme={theme} label="shared" />
                    ) : null}
                    {base.status !== 'active' ? (
                      <Badge theme={theme} label={base.status} tone="danger" />
                    ) : null}
                  </View>
                }
                showChevron
                onPress={() =>
                  router.push({ pathname: '/knowledge-base/[id]', params: { id: base.id } })
                }
              />
            ))}
          </Section>
        )}
      </ScrollView>

      <BottomSheet
        theme={theme}
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New knowledge base"
      >
        <View style={styles.form}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title"
            placeholderTextColor={theme.textDisabled}
            autoFocus
            maxLength={160}
            style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
          />
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Description (optional)"
            placeholderTextColor={theme.textDisabled}
            multiline
            style={[styles.input, styles.textArea, { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
          />
          <SegmentedControl
            theme={theme}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'organization', label: 'Shared' },
              { value: 'personal', label: 'Personal' },
            ]}
          />
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={busy || !title.trim()}
            onPress={() => void handleCreate()}
            style={[styles.newButton, { backgroundColor: theme.foreground, opacity: title.trim() ? 1 : 0.45 }]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.background} />
            ) : (
              <Text style={[styles.newButtonText, { color: theme.background }]}>Create</Text>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  centerWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  errorText: { fontSize: fontSize.sm },
  newButton: {
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  newButtonText: { fontSize: fontSize.sm, fontWeight: '700' },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  form: { gap: spacing.sm },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    fontSize: fontSize.md,
  },
  textArea: { minHeight: 90, paddingVertical: spacing.sm, textAlignVertical: 'top' },
})
