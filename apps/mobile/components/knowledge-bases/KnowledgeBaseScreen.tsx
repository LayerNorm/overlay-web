/**
 * Knowledge base workspace — native counterpart of web
 * `/app/knowledge/[knowledgeBaseId]` (KnowledgeBaseWorkspace): sources list
 * with include/exclude toggles and per-source actions (preview extraction,
 * refresh/retry, remove), file/text/URL source creation, semantic search
 * with citations, per-source diagnostics + freshness, reindex, base
 * edit/delete, and sharing via the unified ShareSheet
 * (resourceType 'knowledge_base' — same dialog web renders).
 *
 * Judgment: connector/drive sources (Google Drive, Dropbox, Notion,
 * Confluence) are not offered — they need a connected-resource picker that
 * doesn't exist on mobile yet (see todos.md).
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import type { KnowledgeBase } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import {
  createKnowledgeBaseSource,
  knowledgeBaseDiagnostics,
  knowledgeSourceExtractionPreview,
  listKnowledgeBases,
  listKnowledgeBaseSources,
  reindexKnowledgeBase,
  removeKnowledgeBase,
  removeKnowledgeBaseSource,
  searchKnowledgeBase,
  updateKnowledgeBase,
  updateKnowledgeBaseSource,
  uploadKnowledgeBaseSource,
  type KnowledgeBaseDiagnosticsResponse,
  type KnowledgeBaseSourceDetail,
  type KnowledgeSourcePreview,
} from '../../services/knowledgeBasesService'

type KnowledgeBaseSearchChunk = Awaited<
  ReturnType<typeof searchKnowledgeBase>
>['chunks'][number]
import {
  BottomSheet,
  EmptyState,
  MainScreenHeader,
  SearchField,
  SegmentedControl,
  TopBarIconButton,
} from '../ui/AppChrome'
import { Badge, ListRow, Section } from '../ui/primitives'
import { KbShareSheet } from './KbShareSheet'

type Tab = 'sources' | 'search' | 'diagnostics'

const SOURCE_ICONS: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  file: 'file-text',
  note: 'book-open',
  memory: 'archive',
  text: 'type',
  url: 'globe',
  connector: 'link',
  drive: 'hard-drive',
}

const FRESHNESS_LABELS: Record<string, string> = {
  fresh: 'Fresh',
  'never-indexed': 'Not indexed',
  stale: 'Stale',
  failed: 'Failed',
}

const EXTERNAL_KINDS = new Set(['url', 'connector', 'drive'])

export function KnowledgeBaseScreen({
  knowledgeBaseId,
}: {
  knowledgeBaseId: string
}): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const [base, setBase] = useState<KnowledgeBase | null>(null)
  const [sources, setSources] = useState<KnowledgeBaseSourceDetail[]>([])
  const [diagnostics, setDiagnostics] = useState<KnowledgeBaseDiagnosticsResponse['sources']>([])
  const [tab, setTab] = useState<Tab>('sources')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [shareOpen, setShareOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [urlValue, setUrlValue] = useState('')
  const [addMode, setAddMode] = useState<'menu' | 'text' | 'url'>('menu')
  const [sourceDetail, setSourceDetail] = useState<KnowledgeBaseSourceDetail | null>(null)
  const [preview, setPreview] = useState<KnowledgeSourcePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [chunks, setChunks] = useState<KnowledgeBaseSearchChunk[]>([])
  const [citations, setCitations] = useState<Array<{ sourceId: string; title: string }>>([])
  const [searched, setSearched] = useState(false)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'refresh') setRefreshing(true)
      else setLoading(true)
      try {
        const [detail, bases] = await Promise.all([
          listKnowledgeBaseSources(knowledgeBaseId),
          listKnowledgeBases().catch(() => []),
        ])
        setSources(detail)
        setBase(bases.find((entry) => entry.id === knowledgeBaseId) ?? null)
        setError(null)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load sources')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [knowledgeBaseId],
  )

  const loadDiagnostics = useCallback(async () => {
    try {
      const response = await knowledgeBaseDiagnostics(knowledgeBaseId)
      setDiagnostics(response.sources)
    } catch {
      setDiagnostics([])
    }
  }, [knowledgeBaseId])

  useEffect(() => {
    void load()
    void loadDiagnostics()
  }, [load, loadDiagnostics])

  const runAction = useCallback(
    async (operation: () => Promise<unknown>, success?: string) => {
      setBusy(true)
      setNotice(null)
      try {
        await operation()
        if (success) setNotice(success)
        await load('refresh')
      } catch (actionError) {
        setNotice(actionError instanceof Error ? actionError.message : 'Action failed')
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const toggleSource = useCallback(
    (detail: KnowledgeBaseSourceDetail) => {
      void runAction(() =>
        updateKnowledgeBaseSource(knowledgeBaseId, {
          sourceId: detail.source.id,
          enabled: !detail.membership.enabled,
        }),
      )
    },
    [knowledgeBaseId, runAction],
  )

  const openSourceDetail = useCallback(
    (detail: KnowledgeBaseSourceDetail) => {
      setSourceDetail(detail)
      setPreview(null)
      setPreviewLoading(true)
      void knowledgeSourceExtractionPreview(knowledgeBaseId, detail.source.id)
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setPreviewLoading(false))
    },
    [knowledgeBaseId],
  )

  const pickAndUpload = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
    if (result.canceled || !result.assets?.length) return
    setAddOpen(false)
    const asset = result.assets[0]!
    await runAction(
      () =>
        uploadKnowledgeBaseSource(knowledgeBaseId, {
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType ?? 'application/octet-stream',
        }),
      `Uploading ${asset.name} — indexing continues in the background.`,
    )
  }, [knowledgeBaseId, runAction])

  const addTextSource = useCallback(async () => {
    if (!textTitle.trim() || !textContent.trim()) return
    setAddOpen(false)
    await runAction(
      () =>
        createKnowledgeBaseSource(knowledgeBaseId, {
          title: textTitle.trim(),
          content: textContent,
          mimeType: 'text/plain',
        }),
      'Text source added.',
    )
    setTextTitle('')
    setTextContent('')
    setAddMode('menu')
  }, [knowledgeBaseId, textTitle, textContent, runAction])

  const addUrlSource = useCallback(async () => {
    if (!urlValue.trim()) return
    setAddOpen(false)
    await runAction(
      () =>
        createKnowledgeBaseSource(knowledgeBaseId, {
          kind: 'url',
          ref: urlValue.trim(),
        }),
      'Website queued for extraction.',
    )
    setUrlValue('')
    setAddMode('menu')
  }, [knowledgeBaseId, urlValue, runAction])

  const runSearch = useCallback(async () => {
    if (!searchQuery.trim() || searching) return
    setSearching(true)
    setSearched(true)
    try {
      const result = await searchKnowledgeBase(knowledgeBaseId, searchQuery.trim())
      setChunks(result.chunks)
      setCitations(result.citations)
    } catch (searchError) {
      setNotice(searchError instanceof Error ? searchError.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }, [knowledgeBaseId, searchQuery, searching])

  const reindex = useCallback(
    (onlyStale: boolean) => {
      void runAction(async () => {
        const response = await reindexKnowledgeBase(knowledgeBaseId, { onlyStale })
        setNotice(
          response.queued.length > 0
            ? `Queued ${response.queued.length} source${response.queued.length === 1 ? '' : 's'} for reindexing.`
            : 'All sources are already current.',
        )
        await loadDiagnostics()
      })
    },
    [knowledgeBaseId, runAction, loadDiagnostics],
  )

  const saveBase = useCallback(async () => {
    if (!editTitle.trim()) return
    setEditOpen(false)
    await runAction(
      () =>
        updateKnowledgeBase(knowledgeBaseId, {
          title: editTitle.trim(),
          description: editDescription.trim() || undefined,
        }).then((updated) => setBase(updated)),
      'Knowledge base updated.',
    )
  }, [knowledgeBaseId, editTitle, editDescription, runAction])

  const deleteBase = useCallback(() => {
    Alert.alert(
      'Delete knowledge base?',
      'Sources and their search index are removed. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void removeKnowledgeBase(knowledgeBaseId)
              .then(() => router.back())
              .catch(() => setNotice('Could not delete the knowledge base'))
          },
        },
      ],
    )
  }, [knowledgeBaseId, router])

  const title = base?.title ?? 'Knowledge base'
  const readyCount = sources.filter((s) => s.source.status === 'ready').length

  const sourcesTab = (
    <View>
      <TouchableOpacity
        activeOpacity={0.85}
        disabled={busy}
        onPress={() => {
          setAddMode('menu')
          setAddOpen(true)
        }}
        style={[styles.primaryButton, { backgroundColor: theme.foreground }]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.background} />
        ) : (
          <Text style={[styles.primaryButtonText, { color: theme.background }]}>Add source</Text>
        )}
      </TouchableOpacity>
      {sources.length === 0 ? (
        <EmptyState
          theme={theme}
          icon="file-text"
          title="No sources yet"
          description="Add a document, pasted text, or a website to make this base searchable."
        />
      ) : (
        <Section theme={theme}>
          {sources.map((detail) => (
            <ListRow
              key={detail.source.id}
              theme={theme}
              icon={SOURCE_ICONS[detail.source.kind] ?? 'file'}
              title={detail.source.title}
              subtitle={`${detail.source.status}${
                detail.source.statusMessage ? ` — ${detail.source.statusMessage}` : ''
              }`}
              selected={detail.membership.enabled}
              onPress={() => openSourceDetail(detail)}
              onLongPress={() => toggleSource(detail)}
              accessory={
                <TouchableOpacity
                  onPress={() => toggleSource(detail)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <View
                    style={[
                      styles.checkbox,
                      {
                        borderColor: detail.membership.enabled ? theme.foreground : theme.border,
                        backgroundColor: detail.membership.enabled ? theme.foreground : 'transparent',
                      },
                    ]}
                  >
                    {detail.membership.enabled ? (
                      <Feather name="check" size={12} color={theme.background} />
                    ) : null}
                  </View>
                </TouchableOpacity>
              }
            />
          ))}
        </Section>
      )}
    </View>
  )

  const searchTab = (
    <View style={styles.searchTab}>
      <View style={styles.searchRow}>
        <View style={styles.searchFieldWrap}>
          <SearchField
            theme={theme}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search this base"
          />
        </View>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={searching || !searchQuery.trim()}
          onPress={() => void runSearch()}
          style={[styles.searchButton, { backgroundColor: theme.foreground, opacity: searchQuery.trim() ? 1 : 0.45 }]}
        >
          {searching ? (
            <ActivityIndicator size="small" color={theme.background} />
          ) : (
            <Feather name="search" size={16} color={theme.background} />
          )}
        </TouchableOpacity>
      </View>
      {chunks.map((chunk, index) => (
        <TouchableOpacity
          key={`${chunk.sourceId}-${chunk.chunkIndex}-${index}`}
          activeOpacity={0.8}
          onPress={() => {
            const detail = sources.find((s) => s.source.id === chunk.knowledgeSourceId)
            if (detail) {
              setTab('sources')
              openSourceDetail(detail)
            }
          }}
          style={[styles.chunkCard, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
        >
          <View style={styles.chunkHeader}>
            <Text style={[styles.chunkTitle, { color: theme.text }]} numberOfLines={1}>
              {chunk.title || 'Source passage'}
            </Text>
            <Text style={[styles.chunkScore, { color: theme.textDisabled }]}>
              {Math.round(chunk.score * 100)}%
            </Text>
          </View>
          <Text style={[styles.chunkText, { color: theme.textSecondary }]} numberOfLines={5}>
            {chunk.text}
          </Text>
        </TouchableOpacity>
      ))}
      {searched && chunks.length === 0 && !searching ? (
        <Text style={[styles.hint, { color: theme.textSecondary }]}>No matching passages.</Text>
      ) : null}
      {citations.length > 0 ? (
        <Text style={[styles.hint, { color: theme.textDisabled }]}>
          {`Citations: ${citations.map((c) => c.title).join(', ')}`}
        </Text>
      ) : null}
      {!searched ? (
        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          Find passages across every enabled source using keyword and semantic search.
        </Text>
      ) : null}
    </View>
  )

  const diagnosticsTab = (
    <View>
      <View style={styles.diagActions}>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={busy}
          onPress={() => reindex(true)}
          style={[styles.secondaryButton, { borderColor: theme.border }]}
        >
          <Feather name="refresh-cw" size={13} color={theme.textSecondary} />
          <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Reindex stale</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={busy}
          onPress={() =>
            Alert.alert('Reindex everything?', 'All sources will be re-extracted and re-embedded.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reindex', onPress: () => reindex(false) },
            ])
          }
          style={[styles.secondaryButton, { borderColor: theme.border }]}
        >
          <Feather name="zap" size={13} color={theme.textSecondary} />
          <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Reindex all</Text>
        </TouchableOpacity>
      </View>
      {diagnostics.length === 0 ? (
        <EmptyState
          theme={theme}
          icon="activity"
          title="No diagnostics"
          description="Diagnostics appear once sources have been processed."
        />
      ) : (
        <Section theme={theme}>
          {diagnostics.map((diag) => (
            <ListRow
              key={diag.sourceId}
              theme={theme}
              icon={SOURCE_ICONS[diag.kind] ?? 'file'}
              title={diag.title}
              subtitle={`${diag.status} · ${diag.chunkCount} chunks · ${diag.embeddedCount} embedded · ${diag.indexedChars} chars${
                diag.embeddingIdentities.length
                  ? ` · ${diag.embeddingIdentities.map((e) => e.modelId).join(', ')}`
                  : ''
              }`}
              accessory={
                <Badge
                  theme={theme}
                  label={FRESHNESS_LABELS[diag.freshness.state] ?? diag.freshness.state}
                  tone={diag.freshness.state === 'failed' ? 'danger' : 'default'}
                />
              }
              onPress={() => {
                const detail = sources.find((s) => s.source.id === diag.sourceId)
                if (detail) openSourceDetail(detail)
              }}
            />
          ))}
        </Section>
      )}
    </View>
  )

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <MainScreenHeader
        theme={theme}
        isDark={isDark}
        topInset={insets.top}
        blurHeight={insets.top + 58}
        leftSlot={<TopBarIconButton theme={theme} icon="arrow-left" onPress={() => router.back()} />}
        centerSlot={
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
              {`${sources.length} source${sources.length === 1 ? '' : 's'} · ${readyCount} ready`}
            </Text>
          </View>
        }
        rightSlot={
          <View style={styles.headerActions}>
            <TopBarIconButton theme={theme} icon="share-2" onPress={() => setShareOpen(true)} />
            <TopBarIconButton
              theme={theme}
              icon="settings"
              onPress={() => {
                setEditTitle(base?.title ?? '')
                setEditDescription(base?.description ?? '')
                setEditOpen(true)
              }}
            />
          </View>
        }
      />

      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void load('refresh')
              void loadDiagnostics()
            }}
            tintColor={theme.textSecondary}
          />
        }
      >
        <SegmentedControl
          theme={theme}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'sources', label: 'Sources' },
            { value: 'search', label: 'Search' },
            { value: 'diagnostics', label: 'Diagnostics' },
          ]}
        />
        {notice ? <Text style={[styles.notice, { color: theme.textSecondary }]}>{notice}</Text> : null}
        {error ? <Text style={[styles.notice, { color: '#EF4444' }]}>{error}</Text> : null}
        {loading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : tab === 'sources' ? (
          sourcesTab
        ) : tab === 'search' ? (
          searchTab
        ) : (
          diagnosticsTab
        )}
      </ScrollView>

      {/* Add-source sheet */}
      <BottomSheet
        theme={theme}
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add source"
      >
        {addMode === 'menu' ? (
          <Section theme={theme}>
            <ListRow
              theme={theme}
              icon="upload"
              title="Upload a file"
              subtitle="PDF, documents, text — extracted and indexed"
              onPress={() => void pickAndUpload()}
            />
            <ListRow
              theme={theme}
              icon="type"
              title="Paste text"
              subtitle="Notes, transcripts, anything you want searchable"
              onPress={() => setAddMode('text')}
            />
            <ListRow
              theme={theme}
              icon="globe"
              title="Add a website"
              subtitle="Fetch and index a public page by URL"
              onPress={() => setAddMode('url')}
            />
          </Section>
        ) : addMode === 'text' ? (
          <View style={styles.form}>
            <TextInput
              value={textTitle}
              onChangeText={setTextTitle}
              placeholder="Title"
              placeholderTextColor={theme.textDisabled}
              style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
            />
            <TextInput
              value={textContent}
              onChangeText={setTextContent}
              placeholder="Paste text…"
              placeholderTextColor={theme.textDisabled}
              multiline
              style={[styles.input, styles.textArea, { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
            />
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={!textTitle.trim() || !textContent.trim() || busy}
              onPress={() => void addTextSource()}
              style={[styles.primaryButton, { backgroundColor: theme.foreground, opacity: textTitle.trim() && textContent.trim() ? 1 : 0.45 }]}
            >
              <Text style={[styles.primaryButtonText, { color: theme.background }]}>Add text source</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              value={urlValue}
              onChangeText={setUrlValue}
              placeholder="https://…"
              placeholderTextColor={theme.textDisabled}
              autoCapitalize="none"
              keyboardType="url"
              style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
            />
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={!urlValue.trim() || busy}
              onPress={() => void addUrlSource()}
              style={[styles.primaryButton, { backgroundColor: theme.foreground, opacity: urlValue.trim() ? 1 : 0.45 }]}
            >
              <Text style={[styles.primaryButtonText, { color: theme.background }]}>Add website</Text>
            </TouchableOpacity>
          </View>
        )}
      </BottomSheet>

      {/* Source detail sheet */}
      <BottomSheet
        theme={theme}
        visible={sourceDetail !== null}
        onClose={() => setSourceDetail(null)}
        title={sourceDetail?.source.title ?? 'Source'}
      >
        {previewLoading ? (
          <View style={styles.centerWrap}>
            <ActivityIndicator color={theme.textSecondary} />
          </View>
        ) : preview ? (
          <View style={[styles.previewBox, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
            <Text style={[styles.previewText, { color: theme.textSecondary }]} numberOfLines={14}>
              {preview.text}
            </Text>
            <Text style={[styles.previewMeta, { color: theme.textDisabled }]}>
              {`${preview.totalChars} chars${preview.truncated ? ' · truncated' : ''}`}
            </Text>
          </View>
        ) : (
          <Text style={[styles.hint, { color: theme.textSecondary }]}>No extraction preview.</Text>
        )}
        <Section theme={theme}>
          <ListRow
            theme={theme}
            icon={sourceDetail?.membership.enabled ? 'minus-square' : 'check-square'}
            title={sourceDetail?.membership.enabled ? 'Exclude from search' : 'Include in search'}
            onPress={() => {
              if (sourceDetail) toggleSource(sourceDetail)
              setSourceDetail(null)
            }}
          />
          {sourceDetail && EXTERNAL_KINDS.has(sourceDetail.source.kind) ? (
            <ListRow
              theme={theme}
              icon="refresh-cw"
              title="Re-fetch from origin"
              onPress={() => {
                void runAction(() =>
                  updateKnowledgeBaseSource(knowledgeBaseId, {
                    sourceId: sourceDetail.source.id,
                    refresh: true,
                  }),
                )
                setSourceDetail(null)
              }}
            />
          ) : null}
          {sourceDetail?.source.status === 'failed' ? (
            <ListRow
              theme={theme}
              icon="rotate-cw"
              title="Retry indexing"
              onPress={() => {
                void runAction(() =>
                  updateKnowledgeBaseSource(knowledgeBaseId, {
                    sourceId: sourceDetail.source.id,
                    retry: true,
                  }),
                )
                setSourceDetail(null)
              }}
            />
          ) : null}
          <ListRow
            theme={theme}
            icon="trash-2"
            title="Remove source"
            destructive
            onPress={() => {
              const detail = sourceDetail
              setSourceDetail(null)
              if (!detail) return
              Alert.alert('Remove source?', 'The source and its search index are deleted.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () =>
                    void runAction(() =>
                      removeKnowledgeBaseSource(knowledgeBaseId, detail.source.id),
                    ),
                },
              ])
            }}
          />
        </Section>
      </BottomSheet>

      {/* Edit / delete sheet */}
      <BottomSheet
        theme={theme}
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        title="Knowledge base settings"
      >
        <View style={styles.form}>
          <TextInput
            value={editTitle}
            onChangeText={setEditTitle}
            placeholder="Title"
            placeholderTextColor={theme.textDisabled}
            style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
          />
          <TextInput
            value={editDescription}
            onChangeText={setEditDescription}
            placeholder="Description (optional)"
            placeholderTextColor={theme.textDisabled}
            multiline
            style={[styles.input, styles.textArea, { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
          />
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={!editTitle.trim() || busy}
            onPress={() => void saveBase()}
            style={[styles.primaryButton, { backgroundColor: theme.foreground, opacity: editTitle.trim() ? 1 : 0.45 }]}
          >
            <Text style={[styles.primaryButtonText, { color: theme.background }]}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              setEditOpen(false)
              deleteBase()
            }}
            style={[styles.dangerButton, { borderColor: '#EF4444' }]}
          >
            <Text style={[styles.dangerButtonText, { color: '#EF4444' }]}>Delete knowledge base</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      <KbShareSheet
        visible={shareOpen}
        theme={theme}
        knowledgeBaseId={knowledgeBaseId}
        knowledgeBaseTitle={title}
        onClose={() => setShareOpen(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: spacing.md, paddingTop: 62, gap: spacing.sm },
  headerCenter: { alignItems: 'center', gap: 1, maxWidth: 210 },
  headerTitle: { fontSize: fontSize.md, fontWeight: '700' },
  headerSubtitle: { fontSize: 11 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  notice: { fontSize: fontSize.sm },
  centerWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  primaryButton: {
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  primaryButtonText: { fontSize: fontSize.sm, fontWeight: '700' },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  secondaryButtonText: { fontSize: fontSize.xs, fontWeight: '600' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchTab: { gap: spacing.sm },
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  searchFieldWrap: { flex: 1 },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chunkCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: 6,
  },
  chunkHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chunkTitle: { flex: 1, fontSize: fontSize.sm, fontWeight: '600' },
  chunkScore: { fontSize: 11 },
  chunkText: { fontSize: fontSize.xs, lineHeight: 17 },
  hint: { fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing.md, lineHeight: 19 },
  diagActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  form: { gap: spacing.sm },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    fontSize: fontSize.md,
  },
  textArea: { minHeight: 120, paddingVertical: spacing.sm, textAlignVertical: 'top' },
  previewBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 6,
  },
  previewText: { fontSize: fontSize.xs, lineHeight: 17 },
  previewMeta: { fontSize: 11 },
  dangerButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    paddingVertical: 12,
  },
  dangerButtonText: { fontSize: fontSize.sm, fontWeight: '700' },
})
