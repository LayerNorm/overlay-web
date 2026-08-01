'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import {
  ArrowLeft,
  Activity,
  BookOpen,
  Check,
  ChevronRight,
  Cloud,
  FileText,
  Globe2,
  Loader2,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { KnowledgeBase } from '@overlay/app-core'
import type {
  KnowledgeBaseSearchResponse,
  KnowledgeBaseSourceDetail,
  KnowledgeSourceDiagnostics,
} from '@overlay/api-client'
import { Button, DialogFrame, IconButton, SegmentedControl } from '@overlay/ui'
import { AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { useAuthorization } from '@/components/providers/AuthorizationProvider'
import { useVisibleReconciliation } from '@/components/useVisibleReconciliation'
import {
  buildConnectedKnowledgeSourceRef,
  type ConnectedKnowledgeSourceRecipe,
} from '@/shared/knowledge/external-source-ref'
import { ShareDialog } from '@/components/share/ShareDialog'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { Select } from '@overlay/ui/primitives'

type SourceTab = 'sources' | 'search'

const ACTIVE_SOURCE_STATUSES = new Set(['pending', 'extracting', 'indexing', 'deleting'])

export function KnowledgeBaseWorkspace({
  canEdit,
  canShare,
  initialKnowledgeBase,
  initialSelectedSourceId,
  initialSources,
}: {
  canEdit: boolean
  canShare: boolean
  initialKnowledgeBase: KnowledgeBase
  initialSelectedSourceId?: string
  initialSources: KnowledgeBaseSourceDetail[]
}) {
  const { activeWorkspaceId } = useWorkspace()
  const router = useRouter()
  const { capabilities, integrationProvider } = useOverlayCapabilities()
  const { can } = useAuthorization()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [knowledgeBase, setKnowledgeBase] = useState(initialKnowledgeBase)
  const [sources, setSources] = useState(initialSources)
  const [sourceTab, setSourceTab] = useState<SourceTab>('sources')
  const [searchRevision, setSearchRevision] = useState(0)
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(
    initialSelectedSourceId &&
      initialSources.some(({ source }) => source.id === initialSelectedSourceId)
      ? initialSelectedSourceId
      : null,
  )
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [textDialogOpen, setTextDialogOpen] = useState(false)
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [savingText, setSavingText] = useState(false)
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [urlTitle, setUrlTitle] = useState('')
  const [urlValue, setUrlValue] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)
  const [connectedDialogOpen, setConnectedDialogOpen] = useState(false)
  const [connectedRecipe, setConnectedRecipe] =
    useState<ConnectedKnowledgeSourceRecipe>('google-drive-file')
  const [connectedResourceId, setConnectedResourceId] = useState('')
  const [connectedTitle, setConnectedTitle] = useState('')
  const [savingConnected, setSavingConnected] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState(initialKnowledgeBase.title)
  const [editDescription, setEditDescription] = useState(initialKnowledgeBase.description ?? '')
  const [savingBase, setSavingBase] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  const selectedSource = useMemo(
    () => sources.find(({ source }) => source.id === selectedSourceId) ?? null,
    [selectedSourceId, sources],
  )
  const readySourceCount = sources.filter(({ source }) => source.status === 'ready').length
  const hasActiveSources = sources.some(({ source }) => ACTIVE_SOURCE_STATUSES.has(source.status))
  const canAddConnectedSource =
    capabilities.integrations &&
    integrationProvider === 'composio' &&
    can('integrations.use')

  const loadSources = useCallback(async () => {
    const response = await overlayAppClient.knowledgeBases.listSources(knowledgeBase.id)
    setSources(response.sources)
  }, [knowledgeBase.id])

  useEffect(() => {
    if (!hasActiveSources) return
    const interval = window.setInterval(() => {
      void loadSources().catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(interval)
  }, [hasActiveSources, loadSources])

  const reconcileWorkspace = useCallback(async () => {
    const [basesResult, sourcesResult] = await Promise.allSettled([
      overlayAppClient.knowledgeBases.list(),
      overlayAppClient.knowledgeBases.listSources(knowledgeBase.id),
    ])
    if (basesResult.status === 'fulfilled') {
      const current = basesResult.value.knowledgeBases.find(({ id }) => id === knowledgeBase.id)
      if (!current) {
        router.replace('/app/knowledge')
        return
      }
      setKnowledgeBase(current)
    }
    if (sourcesResult.status === 'fulfilled') {
      setSources(sourcesResult.value.sources)
    }
  }, [knowledgeBase.id, router])
  useVisibleReconciliation(reconcileWorkspace)

  async function uploadFiles(files: File[]) {
    if (!canEdit || files.length === 0 || uploading) return
    setUploading(true)
    setNotice(null)
    try {
      for (const file of files) {
        await overlayAppClient.knowledgeBases.uploadSource(knowledgeBase.id, file)
      }
      await loadSources()
      setSearchRevision((current) => current + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not upload source')
    } finally {
      setUploading(false)
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    void uploadFiles(files)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    void uploadFiles(Array.from(event.dataTransfer.files))
  }

  async function addTextSource() {
    if (!textTitle.trim() || !textContent.trim() || savingText) return
    setSavingText(true)
    setNotice(null)
    try {
      await overlayAppClient.knowledgeBases.createSource(knowledgeBase.id, {
        title: textTitle.trim(),
        content: textContent,
        mimeType: 'text/plain',
      })
      setTextDialogOpen(false)
      setTextTitle('')
      setTextContent('')
      await loadSources()
      setSearchRevision((current) => current + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add text source')
    } finally {
      setSavingText(false)
    }
  }

  async function addWebsiteSource() {
    if (!urlValue.trim() || savingUrl) return
    setSavingUrl(true)
    setNotice(null)
    try {
      await overlayAppClient.knowledgeBases.createSource(knowledgeBase.id, {
        kind: 'url',
        ref: urlValue.trim(),
        title: urlTitle.trim() || undefined,
      })
      setUrlDialogOpen(false)
      setUrlTitle('')
      setUrlValue('')
      await loadSources()
      setSearchRevision((current) => current + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add website')
    } finally {
      setSavingUrl(false)
    }
  }

  async function addConnectedSource() {
    if (!connectedResourceId.trim() || savingConnected) return
    setSavingConnected(true)
    setNotice(null)
    try {
      const isDrive = connectedRecipe === 'google-drive-file' ||
        connectedRecipe === 'dropbox-file'
      await overlayAppClient.knowledgeBases.createSource(knowledgeBase.id, {
        kind: isDrive ? 'drive' : 'connector',
        ref: buildConnectedKnowledgeSourceRef({
          recipe: connectedRecipe,
          resourceId: connectedResourceId,
        }),
        title: connectedTitle.trim() || undefined,
      })
      setConnectedDialogOpen(false)
      setConnectedResourceId('')
      setConnectedTitle('')
      await loadSources()
      setSearchRevision((current) => current + 1)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add connected source')
    } finally {
      setSavingConnected(false)
    }
  }

  async function reindexStaleSources() {
    if (reindexing) return
    setReindexing(true)
    setNotice(null)
    try {
      const response = await overlayAppClient.knowledgeBases.reindex(knowledgeBase.id, {
        onlyStale: true,
      })
      setNotice(response.queued.length > 0
        ? `Queued ${response.queued.length} ${response.queued.length === 1 ? 'source' : 'sources'} for reindexing.`
        : 'All sources are already current.')
      await loadSources()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not reindex sources')
    } finally {
      setReindexing(false)
    }
  }

  async function toggleSource(sourceId: string, enabled: boolean) {
    setSources((current) => current.map((detail) => detail.source.id === sourceId
      ? { ...detail, membership: { ...detail.membership, enabled } }
      : detail))
    try {
      await overlayAppClient.knowledgeBases.updateSource(knowledgeBase.id, { sourceId, enabled })
      setSearchRevision((current) => current + 1)
    } catch {
      await loadSources()
    }
  }

  async function retrySource(sourceId: string) {
    await overlayAppClient.knowledgeBases.updateSource(knowledgeBase.id, { sourceId, retry: true })
    await loadSources()
    setSearchRevision((current) => current + 1)
  }

  async function deleteSource(sourceId: string) {
    if (!window.confirm('Delete this source and its search index?')) return
    await overlayAppClient.knowledgeBases.removeSource(knowledgeBase.id, {
      sourceId,
      deleteCanonical: true,
    })
    setSelectedSourceId(null)
    await loadSources()
    setSearchRevision((current) => current + 1)
  }

  async function updateKnowledgeBase() {
    if (!editTitle.trim() || savingBase) return
    setSavingBase(true)
    try {
      const response = await overlayAppClient.knowledgeBases.update({
        knowledgeBaseId: knowledgeBase.id,
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
      })
      setKnowledgeBase(response.knowledgeBase)
      setEditOpen(false)
    } finally {
      setSavingBase(false)
    }
  }

  async function deleteKnowledgeBase() {
    if (!window.confirm('Delete this knowledge base and detach all of its sources?')) return
    await overlayAppClient.knowledgeBases.remove(knowledgeBase.id)
    router.replace('/app/knowledge')
  }

  const sourcePanel = (
    <KnowledgeSourcePanel
      canEdit={canEdit}
      dragging={dragging}
      knowledgeBaseId={knowledgeBase.id}
      notice={notice}
      selectedSourceId={selectedSourceId}
      searchRevision={searchRevision}
      sourceTab={sourceTab}
      sources={sources}
      uploading={uploading}
      onAddText={() => setTextDialogOpen(true)}
      onAddWebsite={() => setUrlDialogOpen(true)}
      onAddConnected={canAddConnectedSource ? () => setConnectedDialogOpen(true) : undefined}
      onCloseMobile={() => setMobileSourcesOpen(false)}
      onDrop={handleDrop}
      onDragActive={setDragging}
      onOpenFilePicker={() => fileInputRef.current?.click()}
      onSelectSource={(sourceId) => {
        setSelectedSourceId(sourceId)
        setMobileSourcesOpen(false)
      }}
      onTabChange={setSourceTab}
      onToggleSource={(sourceId, enabled) => void toggleSource(sourceId, enabled)}
    />
  )

  return (
    <>
      <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileInput} />
      <AppScreenShell
        className="h-full"
        contentClassName="flex min-h-0"
        sidebar={sourcePanel}
        sidebarClassName="w-80 xl:w-96"
        header={(
          <AppScreenHeader
            title={knowledgeBase.title}
            subtitle={`${readySourceCount} ${readySourceCount === 1 ? 'source' : 'sources'} ready`}
            leading={(
              <Link href="/app/knowledge" aria-label="Back to knowledge bases" className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--surface-subtle)]">
                <ArrowLeft size={16} />
              </Link>
            )}
            actions={(
              <>
                <Button className="lg:hidden" size="sm" onClick={() => setMobileSourcesOpen(true)}>
                  <Menu size={14} /> Sources
                </Button>
                {canShare ? (
                  <Button size="sm" onClick={() => setShareOpen(true)}>
                    <Share2 size={14} /> Share
                  </Button>
                ) : null}
                {canEdit ? (
                  <IconButton aria-label="Knowledge base settings" onClick={() => setEditOpen(true)}>
                    <MoreHorizontal size={16} />
                  </IconButton>
                ) : null}
              </>
            )}
          />
        )}
        rightPanel={selectedSource ? (
          <SourceInspector
            detail={selectedSource}
            knowledgeBaseId={knowledgeBase.id}
            canEdit={canEdit}
            onClose={() => setSelectedSourceId(null)}
            onDelete={() => void deleteSource(selectedSource.source.id)}
            onRetry={() => void retrySource(selectedSource.source.id)}
          />
        ) : mobileSourcesOpen ? sourcePanel : null}
        rightPanelOpen={Boolean(selectedSource || mobileSourcesOpen)}
        rightPanelWidth={mobileSourcesOpen ? 360 : 420}
        onRightPanelClose={() => {
          setSelectedSourceId(null)
          setMobileSourcesOpen(false)
        }}
        rightPanelOverlayLabel={selectedSource ? 'Knowledge source details' : 'Knowledge sources'}
      >
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6">
          <div className="w-full max-w-xl text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-subtle)] text-[var(--muted)]">
              <BookOpen size={18} />
            </span>
            <h2 className="mt-4 text-sm font-medium text-[var(--foreground)]">{knowledgeBase.title}</h2>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--muted)]">
              {knowledgeBase.description || 'A curated source collection for semantic and keyword retrieval.'}
            </p>
            <div className="mt-5 flex items-center justify-center gap-5 text-xs text-[var(--muted)]">
              <span><strong className="font-medium text-[var(--foreground)]">{sources.length}</strong> sources</span>
              <span><strong className="font-medium text-[var(--foreground)]">{readySourceCount}</strong> ready</span>
            </div>
            <p className="mt-6 text-[11px] text-[var(--muted-light)]">
              Use Sources to manage the corpus or Search to inspect retrieved passages.
            </p>
          </div>
        </div>
      </AppScreenShell>

      <DialogFrame
        open={textDialogOpen}
        onOpenChange={setTextDialogOpen}
        title="Add pasted text"
        description="Paste notes, a transcript, or any text you want to search and cite."
        className="w-[min(620px,94vw)]"
        footer={(
          <>
            <Button onClick={() => setTextDialogOpen(false)} disabled={savingText}>Cancel</Button>
            <Button variant="primary" onClick={() => void addTextSource()} disabled={!textTitle.trim() || !textContent.trim() || savingText}>
              {savingText ? <Loader2 className="animate-spin" size={14} /> : null}
              Add source
            </Button>
          </>
        )}
      >
        <div className="mt-5 space-y-3">
          <input
            value={textTitle}
            onChange={(event) => setTextTitle(event.target.value)}
            placeholder="Source title"
            className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none"
          />
          <textarea
            value={textContent}
            onChange={(event) => setTextContent(event.target.value)}
            rows={10}
            placeholder="Paste source text"
            className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm leading-relaxed outline-none"
          />
        </div>
      </DialogFrame>

      <DialogFrame
        open={urlDialogOpen}
        onOpenChange={setUrlDialogOpen}
        title="Add website"
        description="Overlay will fetch public page content, index it, and retain its origin for citations."
        footer={(
          <>
            <Button onClick={() => setUrlDialogOpen(false)} disabled={savingUrl}>Cancel</Button>
            <Button variant="primary" onClick={() => void addWebsiteSource()} disabled={!urlValue.trim() || savingUrl}>
              {savingUrl ? <Loader2 className="animate-spin" size={14} /> : null}
              Add source
            </Button>
          </>
        )}
      >
        <div className="mt-5 space-y-3">
          <label className="block text-xs font-medium">
            URL
            <input
              autoFocus
              value={urlValue}
              onChange={(event) => setUrlValue(event.target.value)}
              placeholder="https://example.com/handbook"
              inputMode="url"
              className="mt-1.5 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none"
            />
          </label>
          <label className="block text-xs font-medium">
            Title <span className="font-normal text-[var(--muted)]">(optional)</span>
            <input
              value={urlTitle}
              onChange={(event) => setUrlTitle(event.target.value)}
              placeholder="Employee handbook"
              className="mt-1.5 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none"
            />
          </label>
        </div>
      </DialogFrame>

      <DialogFrame
        open={connectedDialogOpen}
        onOpenChange={setConnectedDialogOpen}
        title="Add connected source"
        description="Import a read-only source from a connected workspace app."
        footer={(
          <>
            <Button onClick={() => setConnectedDialogOpen(false)} disabled={savingConnected}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void addConnectedSource()}
              disabled={!connectedResourceId.trim() || savingConnected}
            >
              {savingConnected ? <Loader2 className="animate-spin" size={14} /> : null}
              Add source
            </Button>
          </>
        )}
      >
        <div className="mt-5 space-y-3">
          <label className="block text-xs font-medium">
            Provider
            <Select
              value={connectedRecipe}
              onChange={(event) =>
                setConnectedRecipe(event.target.value as ConnectedKnowledgeSourceRecipe)}
              className="mt-1.5 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none"
            >
              <option value="google-drive-file">Google Drive file</option>
              <option value="dropbox-file">Dropbox file</option>
              <option value="notion-page">Notion page</option>
              <option value="confluence-page">Confluence page</option>
            </Select>
          </label>
          <label className="block text-xs font-medium">
            {connectedSourceIdentifierLabel(connectedRecipe)}
            <input
              autoFocus
              value={connectedResourceId}
              onChange={(event) => setConnectedResourceId(event.target.value)}
              placeholder={connectedSourceIdentifierPlaceholder(connectedRecipe)}
              className="mt-1.5 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none"
            />
          </label>
          <label className="block text-xs font-medium">
            Title <span className="font-normal text-[var(--muted)]">(optional)</span>
            <input
              value={connectedTitle}
              onChange={(event) => setConnectedTitle(event.target.value)}
              placeholder="Source title"
              className="mt-1.5 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none"
            />
          </label>
        </div>
      </DialogFrame>

      <DialogFrame
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Knowledge base settings"
        footer={(
          <>
            <Button variant="danger" onClick={() => void deleteKnowledgeBase()}>
              <Trash2 size={14} /> Delete
            </Button>
            <span className="flex-1" />
            <Button onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void updateKnowledgeBase()} disabled={!editTitle.trim() || savingBase}>
              {savingBase ? <Loader2 className="animate-spin" size={14} /> : null}
              Save
            </Button>
          </>
        )}
      >
        <div className="mt-5 space-y-3">
          <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none" />
          <textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} rows={4} placeholder="Description" className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none" />
          <div className="rounded-md border border-[var(--border)] p-3">
            <div className="flex items-center gap-3">
              <Activity size={15} className="text-[var(--muted)]" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">Index health</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">Reindex sources whose content or embedding identity is stale.</p>
              </div>
              <Button size="sm" onClick={() => void reindexStaleSources()} disabled={reindexing}>
                {reindexing ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />}
                Reindex stale
              </Button>
            </div>
            {notice ? <p role="status" className="mt-2 text-[11px] text-[var(--muted)]">{notice}</p> : null}
          </div>
        </div>
      </DialogFrame>

      <ShareDialog
        workspaceId={activeWorkspaceId}
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        resource={{
          id: knowledgeBase.id,
          type: 'knowledge_base',
          title: knowledgeBase.title,
        }}
      />
    </>
  )
}

function connectedSourceIdentifierLabel(recipe: ConnectedKnowledgeSourceRecipe): string {
  switch (recipe) {
    case 'google-drive-file': return 'Google Drive file ID'
    case 'dropbox-file': return 'Dropbox file path'
    case 'notion-page': return 'Notion page ID'
    case 'confluence-page': return 'Confluence page ID'
  }
}

function connectedSourceIdentifierPlaceholder(recipe: ConnectedKnowledgeSourceRecipe): string {
  switch (recipe) {
    case 'google-drive-file': return '1AbCdefGhijkLmnoP'
    case 'dropbox-file': return '/Company/Handbook.pdf'
    case 'notion-page': return '2f22b4dbb7d1801b...'
    case 'confluence-page': return '123456789'
  }
}

function KnowledgeSourcePanel({
  canEdit,
  dragging,
  knowledgeBaseId,
  notice,
  selectedSourceId,
  searchRevision,
  sourceTab,
  sources,
  uploading,
  onAddText,
  onAddWebsite,
  onAddConnected,
  onCloseMobile,
  onDragActive,
  onDrop,
  onOpenFilePicker,
  onSelectSource,
  onTabChange,
  onToggleSource,
}: {
  canEdit: boolean
  dragging: boolean
  knowledgeBaseId: string
  notice: string | null
  selectedSourceId: string | null
  searchRevision: number
  sourceTab: SourceTab
  sources: KnowledgeBaseSourceDetail[]
  uploading: boolean
  onAddText: () => void
  onAddWebsite: () => void
  onAddConnected?: () => void
  onCloseMobile: () => void
  onDragActive: (active: boolean) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onOpenFilePicker: () => void
  onSelectSource: (id: string) => void
  onTabChange: (tab: SourceTab) => void
  onToggleSource: (sourceId: string, enabled: boolean) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<KnowledgeBaseSearchResponse | null>(null)

  useEffect(() => {
    setSearchResult(null)
  }, [searchRevision])

  async function searchKnowledgeBase() {
    if (!searchQuery.trim() || searching) return
    setSearching(true)
    try {
      setSearchResult(await overlayAppClient.knowledgeBases.search(knowledgeBaseId, {
        query: searchQuery.trim(),
        limit: 12,
      }))
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--sidebar-surface)]">
      <div className="flex h-14 min-h-14 shrink-0 items-center justify-between border-b border-[var(--border)] px-4 md:h-16 md:min-h-16">
        <div className="flex items-center gap-2 text-sm font-medium"><BookOpen size={15} /> Notebook</div>
        <IconButton className="lg:hidden" aria-label="Close sources" onClick={onCloseMobile}><X size={15} /></IconButton>
      </div>
      <div className="flex justify-center border-b border-[var(--border)] px-3 py-2">
        <SegmentedControl
          value={sourceTab}
          options={[
            { value: 'sources', label: 'Sources' },
            { value: 'search', label: 'Search' },
          ]}
          onChange={onTabChange}
          ariaLabel="Knowledge base views"
          className="w-full [&>button]:flex-1"
        />
      </div>
      {sourceTab === 'sources' ? (
        <>
          {canEdit ? (
            <div className="border-b border-[var(--border)] p-3">
              <div
                onDragEnter={(event) => { event.preventDefault(); onDragActive(true) }}
                onDragOver={(event) => { event.preventDefault(); onDragActive(true) }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragActive(false)
                }}
                onDrop={onDrop}
                className={`flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed px-4 text-center transition-colors ${dragging ? 'border-[var(--foreground)] bg-[var(--surface-subtle)]' : 'border-[var(--border)]'}`}
                data-testid="knowledge-source-dropzone"
              >
                {uploading ? <Loader2 className="animate-spin text-[var(--muted)]" size={19} /> : <Upload className="text-[var(--muted)]" size={19} />}
                <p className="mt-2 text-xs font-medium">{uploading ? 'Adding sources…' : 'Drop files here'}</p>
                <p className="mt-1 text-[11px] text-[var(--muted)]">PDF, Office, text, and code files</p>
              </div>
              <div className={`mt-2 grid gap-2 ${onAddConnected ? 'grid-cols-2' : 'grid-cols-3'}`}>
                <Button size="sm" onClick={onOpenFilePicker}><Plus size={13} /> Add files</Button>
                <Button size="sm" onClick={onAddText}><FileText size={13} /> Paste text</Button>
                <Button size="sm" onClick={onAddWebsite}><Globe2 size={13} /> Website</Button>
                {onAddConnected ? (
                  <Button size="sm" onClick={onAddConnected}><Cloud size={13} /> Connected</Button>
                ) : null}
              </div>
              {notice ? <p role="alert" className="mt-2 text-xs text-red-500">{notice}</p> : null}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {sources.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs leading-relaxed text-[var(--muted)]">
                No sources yet. Add a document to make this knowledge base searchable.
              </div>
            ) : sources.map((detail) => (
              <SourceRow
                key={detail.source.id}
                detail={detail}
                selected={selectedSourceId === detail.source.id}
                canEdit={canEdit}
                onSelect={() => onSelectSource(detail.source.id)}
                onToggle={(enabled) => onToggleSource(detail.source.id, enabled)}
              />
            ))}
          </div>
        </>
      ) : sourceTab === 'search' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="flex gap-2">
            <label className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={13} />
              <span className="sr-only">Search this knowledge base</span>
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchKnowledgeBase() }} placeholder="Search sources" className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] pl-8 pr-2 text-xs outline-none" />
            </label>
            <IconButton aria-label="Search" onClick={() => void searchKnowledgeBase()} disabled={!searchQuery.trim() || searching}>
              {searching ? <Loader2 className="animate-spin" size={14} /> : <ChevronRight size={14} />}
            </IconButton>
          </div>
          {searchResult ? (
            <div className="mt-4 space-y-2">
              {searchResult.chunks.length === 0 ? <p className="py-8 text-center text-xs text-[var(--muted)]">No matching passages.</p> : searchResult.chunks.map((chunk, index) => (
                <button key={`${chunk.sourceId}-${chunk.chunkIndex}-${index}`} type="button" onClick={() => chunk.knowledgeSourceId && onSelectSource(chunk.knowledgeSourceId)} className="w-full rounded-md border border-[var(--border)] p-3 text-left hover:bg-[var(--surface-subtle)]">
                  <p className="truncate text-xs font-medium">{chunk.title || 'Source passage'}</p>
                  <p className="mt-1.5 line-clamp-4 text-[11px] leading-relaxed text-[var(--muted)]">{chunk.text}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-3 py-10 text-center text-xs leading-relaxed text-[var(--muted)]">Find passages across every enabled source using keyword and semantic search.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function SourceRow({
  canEdit,
  detail,
  onSelect,
  onToggle,
  selected,
}: {
  canEdit: boolean
  detail: KnowledgeBaseSourceDetail
  onSelect: () => void
  onToggle: (enabled: boolean) => void
  selected: boolean
}) {
  const busy = ACTIVE_SOURCE_STATUSES.has(detail.source.status)
  return (
    <div
      className={`group flex items-center gap-2 rounded-md px-2 py-2 ${selected ? 'bg-[var(--surface-subtle)]' : 'hover:bg-[var(--surface-subtle)]'}`}
      data-testid={`knowledge-source-${detail.source.id}`}
    >
      {canEdit ? (
        <button type="button" aria-label={`${detail.membership.enabled ? 'Exclude' : 'Include'} ${detail.source.title}`} onClick={() => onToggle(!detail.membership.enabled)} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${detail.membership.enabled ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]' : 'border-[var(--border)]'}`}>
          {detail.membership.enabled ? <Check size={12} /> : null}
        </button>
      ) : null}
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <FileText size={14} className="shrink-0 text-[var(--muted)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{detail.source.title}</span>
          <span
            className={`mt-0.5 block text-[10px] capitalize ${detail.source.status === 'failed' ? 'text-red-500' : 'text-[var(--muted)]'}`}
            data-testid={`knowledge-source-status-${detail.source.id}`}
          >
            {busy ? <Loader2 className="mr-1 inline animate-spin" size={9} /> : null}
            {detail.source.status}
          </span>
        </span>
        <ChevronRight size={13} className="shrink-0 text-[var(--muted)] opacity-0 group-hover:opacity-100" />
      </button>
    </div>
  )
}

function SourceInspector({
  canEdit,
  detail,
  knowledgeBaseId,
  onClose,
  onDelete,
  onRetry,
}: {
  canEdit: boolean
  detail: KnowledgeBaseSourceDetail
  knowledgeBaseId: string
  onClose: () => void
  onDelete: () => void
  onRetry: () => void
}) {
  const [diagnostics, setDiagnostics] = useState<KnowledgeSourceDiagnostics | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true)
  const [reindexing, setReindexing] = useState(false)
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null)
  const fileId = detail.source.sourceRef?.startsWith('file:')
    ? detail.source.sourceRef.slice('file:'.length)
    : null
  const external = detail.source.kind === 'url' || detail.source.kind === 'connector' || detail.source.kind === 'drive'

  const loadDiagnostics = useCallback(async () => {
    setLoadingDiagnostics(true)
    setDiagnosticsError(null)
    try {
      const [health, extraction] = await Promise.all([
        overlayAppClient.knowledgeBases.diagnostics(knowledgeBaseId),
        overlayAppClient.knowledgeBases.extractionPreview(knowledgeBaseId, detail.source.id)
          .catch(() => null),
      ])
      setDiagnostics(health.sources.find(({ sourceId }) => sourceId === detail.source.id) ?? null)
      setPreview(extraction?.preview.text ?? detail.source.contentPreview ?? null)
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : 'Could not load index diagnostics')
    } finally {
      setLoadingDiagnostics(false)
    }
  }, [detail.source.contentPreview, detail.source.id, knowledgeBaseId])

  useEffect(() => {
    void loadDiagnostics()
  }, [loadDiagnostics])

  async function reindexSource() {
    if (reindexing) return
    setReindexing(true)
    setDiagnosticsError(null)
    try {
      await overlayAppClient.knowledgeBases.reindex(knowledgeBaseId, {
        sourceId: detail.source.id,
      })
      await loadDiagnostics()
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : 'Could not reindex source')
    } finally {
      setReindexing(false)
    }
  }

  async function refreshExternalSource() {
    if (reindexing) return
    setReindexing(true)
    setDiagnosticsError(null)
    try {
      await overlayAppClient.knowledgeBases.updateSource(knowledgeBaseId, {
        sourceId: detail.source.id,
        refresh: true,
      })
      await loadDiagnostics()
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : 'Could not refresh source')
    } finally {
      setReindexing(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 min-h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 md:h-16 md:min-h-16">
        <FileText size={15} />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{detail.source.title}</p>
        <IconButton aria-label="Close source" onClick={onClose}><X size={15} /></IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <dl className="grid grid-cols-[90px_1fr] gap-x-4 gap-y-3 text-xs">
          <dt className="text-[var(--muted)]">Status</dt><dd className="capitalize">{detail.source.status}</dd>
          <dt className="text-[var(--muted)]">Type</dt><dd>{detail.source.mimeType || detail.source.kind}</dd>
          <dt className="text-[var(--muted)]">Included</dt><dd>{detail.membership.enabled ? 'Yes' : 'No'}</dd>
          <dt className="text-[var(--muted)]">Freshness</dt>
          <dd className="capitalize">{loadingDiagnostics ? 'Checking…' : diagnostics?.freshness.state.replace('-', ' ') ?? 'Unavailable'}</dd>
          <dt className="text-[var(--muted)]">Passages</dt><dd>{diagnostics?.chunkCount ?? '—'}</dd>
          <dt className="text-[var(--muted)]">Embedded</dt><dd>{diagnostics?.embeddedCount ?? '—'}</dd>
          <dt className="text-[var(--muted)]">Indexed text</dt><dd>{diagnostics ? formatCharacterCount(diagnostics.indexedChars) : '—'}</dd>
        </dl>
        {diagnostics?.freshness.reason ? (
          <p className="mt-4 rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
            {diagnostics.freshness.reason}
          </p>
        ) : null}
        {diagnosticsError ? <p role="alert" className="mt-4 text-xs text-red-500">{diagnosticsError}</p> : null}
        {detail.source.statusMessage ? <p className="mt-5 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs leading-relaxed text-red-500">{detail.source.statusMessage}</p> : null}
        {preview ? (
          <div className="mt-6">
            <p className="text-xs font-medium">Extracted text</p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-6 text-[var(--muted)]">{preview}</pre>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] p-3">
        {fileId ? <Button size="sm" onClick={() => window.location.assign(`/app/files?file=${encodeURIComponent(fileId)}`)}>Open file</Button> : null}
        {canEdit && external ? <Button size="sm" onClick={() => void refreshExternalSource()} disabled={reindexing}><RefreshCw size={13} /> Refresh origin</Button> : null}
        {canEdit && detail.source.status === 'failed' ? <Button size="sm" onClick={onRetry}><RefreshCw size={13} /> Retry</Button> : null}
        {canEdit && detail.source.status === 'ready' ? <Button size="sm" onClick={() => void reindexSource()} disabled={reindexing}>{reindexing ? <Loader2 className="animate-spin" size={13} /> : <Activity size={13} />} Reindex</Button> : null}
        {canEdit ? <Button size="sm" variant="ghost" className="ml-auto text-red-500" onClick={onDelete}><Trash2 size={13} /> Delete</Button> : null}
      </div>
    </div>
  )
}

function formatCharacterCount(value: number): string {
  if (value < 1_000) return `${value} chars`
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k chars`
}
