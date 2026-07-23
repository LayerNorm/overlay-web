'use client'

import dynamic from 'next/dynamic'
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
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  Loader2,
  Menu,
  MessageSquare,
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
  KnowledgeBaseGrantsResponse,
  KnowledgeBaseSearchResponse,
  KnowledgeBaseShareDirectoryResponse,
  KnowledgeBaseSourceDetail,
} from '@overlay/api-client'
import { Button, DialogFrame, IconButton } from '@overlay/ui'
import { AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useAuth } from '@/contexts/AuthContext'

const ChatSuspenseBoundary = dynamic(() => import('@/features/chat/components/ChatSuspenseBoundary'), {
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
      <Loader2 className="mr-2 animate-spin" size={15} />
      Loading chat
    </div>
  ),
})

type ConversationSummary = {
  _id?: string
  id?: string
  title?: string
  updatedAt?: number
}

type SourceTab = 'sources' | 'search' | 'chats'

const ACTIVE_SOURCE_STATUSES = new Set(['pending', 'extracting', 'indexing', 'deleting'])

export function KnowledgeBaseWorkspace({
  canEdit,
  canShare,
  initialConversations,
  initialKnowledgeBase,
  initialSources,
  userId,
}: {
  canEdit: boolean
  canShare: boolean
  initialConversations: ConversationSummary[]
  initialKnowledgeBase: KnowledgeBase
  initialSources: KnowledgeBaseSourceDetail[]
  userId: string
}) {
  const router = useRouter()
  const { refreshSession } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [knowledgeBase, setKnowledgeBase] = useState(initialKnowledgeBase)
  const [sources, setSources] = useState(initialSources)
  const [conversations, setConversations] = useState(initialConversations)
  const [sourceTab, setSourceTab] = useState<SourceTab>('sources')
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [textDialogOpen, setTextDialogOpen] = useState(false)
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [savingText, setSavingText] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState(initialKnowledgeBase.title)
  const [editDescription, setEditDescription] = useState(initialKnowledgeBase.description ?? '')
  const [savingBase, setSavingBase] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [sharePrincipalType, setSharePrincipalType] = useState<'user' | 'group' | 'role'>('user')
  const [sharePrincipalId, setSharePrincipalId] = useState('')
  const [shareAccessRole, setShareAccessRole] = useState<'viewer' | 'editor'>('viewer')
  const [grants, setGrants] = useState<KnowledgeBaseGrantsResponse['grants']>([])
  const [shareDirectory, setShareDirectory] = useState<KnowledgeBaseShareDirectoryResponse>({
    users: [],
    groups: [],
    roles: [],
  })
  const [shareDirectoryLoading, setShareDirectoryLoading] = useState(false)
  const [sharing, setSharing] = useState(false)

  const selectedSource = useMemo(
    () => sources.find(({ source }) => source.id === selectedSourceId) ?? null,
    [selectedSourceId, sources],
  )
  const readySourceCount = sources.filter(({ source }) => source.status === 'ready').length
  const hasActiveSources = sources.some(({ source }) => ACTIVE_SOURCE_STATUSES.has(source.status))

  const loadSources = useCallback(async () => {
    const response = await overlayAppClient.knowledgeBases.listSources(knowledgeBase.id)
    setSources(response.sources)
  }, [knowledgeBase.id])

  const loadConversations = useCallback(async () => {
    const response = await overlayAppClient.knowledgeBases.listConversations<ConversationSummary[]>(knowledgeBase.id)
    setConversations(response.conversations)
  }, [knowledgeBase.id])

  useEffect(() => {
    if (!hasActiveSources) return
    const interval = window.setInterval(() => void loadSources(), 2000)
    return () => window.clearInterval(interval)
  }, [hasActiveSources, loadSources])

  async function uploadFiles(files: File[]) {
    if (!canEdit || files.length === 0 || uploading) return
    setUploading(true)
    setNotice(null)
    try {
      for (const file of files) {
        await overlayAppClient.knowledgeBases.uploadSource(knowledgeBase.id, file)
      }
      await loadSources()
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
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add text source')
    } finally {
      setSavingText(false)
    }
  }

  async function toggleSource(sourceId: string, enabled: boolean) {
    setSources((current) => current.map((detail) => detail.source.id === sourceId
      ? { ...detail, membership: { ...detail.membership, enabled } }
      : detail))
    try {
      await overlayAppClient.knowledgeBases.updateSource(knowledgeBase.id, { sourceId, enabled })
    } catch {
      await loadSources()
    }
  }

  async function retrySource(sourceId: string) {
    await overlayAppClient.knowledgeBases.updateSource(knowledgeBase.id, { sourceId, retry: true })
    await loadSources()
  }

  async function deleteSource(sourceId: string) {
    if (!window.confirm('Delete this source and its search index?')) return
    await overlayAppClient.knowledgeBases.removeSource(knowledgeBase.id, {
      sourceId,
      deleteCanonical: true,
    })
    setSelectedSourceId(null)
    await loadSources()
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

  async function openShareDialog() {
    setShareOpen(true)
    setShareDirectoryLoading(true)
    setNotice(null)
    try {
      // Direct page loads can render before the client session check settles.
      // Resolve that boundary before protected sharing requests so a transient
      // 401 cannot leave the directory in a permanently empty state.
      await refreshSession()
      const [grantsResponse, directoryResponse] = await Promise.all([
        overlayAppClient.knowledgeBases.listGrants(knowledgeBase.id),
        overlayAppClient.knowledgeBases.listShareDirectory(),
      ])
      setGrants(grantsResponse.grants)
      setShareDirectory(directoryResponse)
    } catch (error) {
      setGrants([])
      setNotice(error instanceof Error ? error.message : 'Could not load sharing options')
    } finally {
      setShareDirectoryLoading(false)
    }
  }

  async function shareKnowledgeBase() {
    if (!sharePrincipalId.trim() || sharing) return
    setSharing(true)
    setNotice(null)
    try {
      const response = await overlayAppClient.knowledgeBases.share(knowledgeBase.id, {
        principalType: sharePrincipalType,
        principalId: sharePrincipalId.trim(),
        accessRole: shareAccessRole,
      })
      setGrants((current) => [response.grant, ...current.filter(({ id }) => id !== response.grant.id)])
      setSharePrincipalId('')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not share knowledge base')
    } finally {
      setSharing(false)
    }
  }

  async function revokeGrant(grantId: string) {
    await overlayAppClient.knowledgeBases.revokeShare(knowledgeBase.id, { grantId })
    setGrants((current) => current.filter(({ id }) => id !== grantId))
  }

  const sourcePanel = (
    <KnowledgeSourcePanel
      canEdit={canEdit}
      conversations={conversations}
      dragging={dragging}
      knowledgeBaseId={knowledgeBase.id}
      notice={notice}
      selectedSourceId={selectedSourceId}
      sourceTab={sourceTab}
      sources={sources}
      uploading={uploading}
      onAddText={() => setTextDialogOpen(true)}
      onCloseMobile={() => setMobileSourcesOpen(false)}
      onDrop={handleDrop}
      onDragActive={setDragging}
      onOpenFilePicker={() => fileInputRef.current?.click()}
      onRefreshConversations={() => void loadConversations()}
      onSelectConversation={(conversationId) => {
        router.replace(`/app/knowledge/${encodeURIComponent(knowledgeBase.id)}?id=${encodeURIComponent(conversationId)}`)
        setMobileSourcesOpen(false)
      }}
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
                  <Button size="sm" onClick={() => void openShareDialog()}>
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
        <div className="min-h-0 min-w-0 flex-1">
          <ChatSuspenseBoundary
            userId={userId}
            hideHeader
            hideSidebar
            knowledgeBaseId={knowledgeBase.id}
            projectName={knowledgeBase.title}
            belowEmptyComposer={readySourceCount === 0 ? (
              <p className="mt-3 text-center text-xs text-[var(--muted)]">
                Add a source before asking source-backed questions.
              </p>
            ) : undefined}
          />
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
        </div>
      </DialogFrame>

      <DialogFrame
        open={shareOpen}
        onOpenChange={setShareOpen}
        title="Share knowledge base"
        description="Grant access to a user, group, or custom role."
        className="w-[min(540px,94vw)]"
      >
        <div className="mt-5 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)_100px]">
          <select aria-label="Principal type" value={sharePrincipalType} onChange={(event) => {
            setSharePrincipalType(event.target.value as typeof sharePrincipalType)
            setSharePrincipalId('')
          }} className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs">
            <option value="user">User</option>
            <option value="group">Group</option>
            <option value="role">Role</option>
          </select>
          <select
            aria-label={`Select ${sharePrincipalType}`}
            value={sharePrincipalId}
            onChange={(event) => setSharePrincipalId(event.target.value)}
            disabled={shareDirectoryLoading}
            className="h-9 min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none disabled:opacity-60"
          >
            <option value="">{shareDirectoryLoading ? 'Loading directory...' : `Select ${sharePrincipalType}`}</option>
            {directoryEntries(shareDirectory, sharePrincipalType).map((entry) => (
              <option key={entry.id} value={entry.id}>{directoryEntryLabel(entry)}</option>
            ))}
          </select>
          <select aria-label="Access role" value={shareAccessRole} onChange={(event) => setShareAccessRole(event.target.value as typeof shareAccessRole)} className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs">
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
        </div>
        <Button variant="primary" size="sm" className="mt-3" onClick={() => void shareKnowledgeBase()} disabled={!sharePrincipalId.trim() || sharing}>
          {sharing ? <Loader2 className="animate-spin" size={13} /> : <Plus size={13} />}
          Add access
        </Button>
        <div className="mt-5 border-t border-[var(--border)] pt-3">
          <p className="text-xs font-medium">People and groups with access</p>
          {grants.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--muted)]">No additional access grants.</p>
          ) : (
            <div className="mt-2 max-h-56 overflow-y-auto">
              {grants.map((grant) => (
                <div key={grant.id} className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{principalLabel(shareDirectory, grant.principalType, grant.principalId)}</p>
                    <p className="text-[11px] text-[var(--muted)]">{grant.principalType} · {grant.accessRole}</p>
                  </div>
                  <IconButton aria-label="Remove access" onClick={() => void revokeGrant(grant.id)}>
                    <X size={14} />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogFrame>
    </>
  )
}

function directoryEntries(
  directory: KnowledgeBaseShareDirectoryResponse,
  type: 'user' | 'group' | 'role',
) {
  if (type === 'user') return directory.users
  if (type === 'group') return directory.groups
  return directory.roles
}

function directoryEntryLabel(entry: KnowledgeBaseShareDirectoryResponse['users'][number]): string {
  if (entry.email && entry.name && entry.name !== entry.email) return `${entry.name} (${entry.email})`
  return entry.email || entry.name || entry.id
}

function principalLabel(
  directory: KnowledgeBaseShareDirectoryResponse,
  type: 'user' | 'group' | 'role',
  id: string,
): string {
  const entry = directoryEntries(directory, type).find((candidate) => candidate.id === id)
  return entry ? directoryEntryLabel(entry) : id
}

function KnowledgeSourcePanel({
  canEdit,
  conversations,
  dragging,
  knowledgeBaseId,
  notice,
  selectedSourceId,
  sourceTab,
  sources,
  uploading,
  onAddText,
  onCloseMobile,
  onDragActive,
  onDrop,
  onOpenFilePicker,
  onRefreshConversations,
  onSelectConversation,
  onSelectSource,
  onTabChange,
  onToggleSource,
}: {
  canEdit: boolean
  conversations: ConversationSummary[]
  dragging: boolean
  knowledgeBaseId: string
  notice: string | null
  selectedSourceId: string | null
  sourceTab: SourceTab
  sources: KnowledgeBaseSourceDetail[]
  uploading: boolean
  onAddText: () => void
  onCloseMobile: () => void
  onDragActive: (active: boolean) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onOpenFilePicker: () => void
  onRefreshConversations: () => void
  onSelectConversation: (id: string) => void
  onSelectSource: (id: string) => void
  onTabChange: (tab: SourceTab) => void
  onToggleSource: (sourceId: string, enabled: boolean) => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<KnowledgeBaseSearchResponse | null>(null)

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
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
        <div className="flex items-center gap-2 text-sm font-medium"><BookOpen size={15} /> Notebook</div>
        <IconButton className="lg:hidden" aria-label="Close sources" onClick={onCloseMobile}><X size={15} /></IconButton>
      </div>
      <div className="grid grid-cols-3 border-b border-[var(--border)] px-2 py-2">
        {(['sources', 'search', 'chats'] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => onTabChange(tab)} className={`h-8 rounded-md text-xs font-medium capitalize ${sourceTab === tab ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'}`}>
            {tab}
          </button>
        ))}
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
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button size="sm" onClick={onOpenFilePicker}><Plus size={13} /> Add files</Button>
                <Button size="sm" onClick={onAddText}><FileText size={13} /> Paste text</Button>
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
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-xs font-medium">Notebook chats</p>
            <IconButton aria-label="Refresh chats" onClick={onRefreshConversations}><RefreshCw size={13} /></IconButton>
          </div>
          {conversations.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-[var(--muted)]">Your grounded chats will appear here.</p>
          ) : conversations.map((conversation) => {
            const id = conversation._id ?? conversation.id
            if (!id) return null
            return (
              <button key={id} type="button" onClick={() => onSelectConversation(id)} className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs hover:bg-[var(--surface-subtle)]">
                <MessageSquare size={13} className="shrink-0 text-[var(--muted)]" />
                <span className="truncate">{conversation.title || 'New chat'}</span>
              </button>
            )
          })}
        </div>
      )}
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
    <div className={`group flex items-center gap-2 rounded-md px-2 py-2 ${selected ? 'bg-[var(--surface-subtle)]' : 'hover:bg-[var(--surface-subtle)]'}`}>
      {canEdit ? (
        <button type="button" aria-label={`${detail.membership.enabled ? 'Exclude' : 'Include'} ${detail.source.title}`} onClick={() => onToggle(!detail.membership.enabled)} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${detail.membership.enabled ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]' : 'border-[var(--border)]'}`}>
          {detail.membership.enabled ? <Check size={12} /> : null}
        </button>
      ) : null}
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <FileText size={14} className="shrink-0 text-[var(--muted)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{detail.source.title}</span>
          <span className={`mt-0.5 block text-[10px] capitalize ${detail.source.status === 'failed' ? 'text-red-500' : 'text-[var(--muted)]'}`}>
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
  onClose,
  onDelete,
  onRetry,
}: {
  canEdit: boolean
  detail: KnowledgeBaseSourceDetail
  onClose: () => void
  onDelete: () => void
  onRetry: () => void
}) {
  const fileId = detail.source.sourceRef?.startsWith('file:')
    ? detail.source.sourceRef.slice('file:'.length)
    : null
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] px-4">
        <FileText size={15} />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{detail.source.title}</p>
        <IconButton aria-label="Close source" onClick={onClose}><X size={15} /></IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <dl className="grid grid-cols-[90px_1fr] gap-x-4 gap-y-3 text-xs">
          <dt className="text-[var(--muted)]">Status</dt><dd className="capitalize">{detail.source.status}</dd>
          <dt className="text-[var(--muted)]">Type</dt><dd>{detail.source.mimeType || detail.source.kind}</dd>
          <dt className="text-[var(--muted)]">Included</dt><dd>{detail.membership.enabled ? 'Yes' : 'No'}</dd>
        </dl>
        {detail.source.statusMessage ? <p className="mt-5 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs leading-relaxed text-red-500">{detail.source.statusMessage}</p> : null}
        {detail.source.contentPreview ? (
          <div className="mt-6">
            <p className="text-xs font-medium">Extracted text</p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-6 text-[var(--muted)]">{detail.source.contentPreview}</pre>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] p-3">
        {fileId ? <Button size="sm" onClick={() => window.location.assign(`/app/files?file=${encodeURIComponent(fileId)}`)}>Open file</Button> : null}
        {canEdit && detail.source.status === 'failed' ? <Button size="sm" onClick={onRetry}><RefreshCw size={13} /> Retry</Button> : null}
        {canEdit ? <Button size="sm" variant="ghost" className="ml-auto text-red-500" onClick={onDelete}><Trash2 size={13} /> Delete</Button> : null}
      </div>
    </div>
  )
}
