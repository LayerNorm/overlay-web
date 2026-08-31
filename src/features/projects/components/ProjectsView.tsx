'use client'

// Web host adapter: Next routing and browser transport stay at the platform
// boundary while reusable project and file presentation lives in @overlay/modules-react.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Archive, ArchiveRestore, Folder, Loader2, MoreVertical, Pencil, Plus } from 'lucide-react'
import {
  CHAT_CREATED_EVENT,
  CHAT_DELETED_EVENT,
  CHAT_TITLE_UPDATED_EVENT,
  type ChatCreatedDetail,
  type ChatDeletedDetail,
  type ChatTitleUpdatedDetail,
} from '@/shared/chat/chat-title'
import {
  KNOWLEDGE_ENTITY_MUTATION_EVENT,
  KNOWLEDGE_RECONCILE_EVENT,
  KnowledgeMutationConsumer,
  PROJECT_META_UPDATED_EVENT,
  PROJECTS_CHANGED_EVENT,
  createProjectNoteRequest,
  createKnowledgeMutationPublisher,
  isKnowledgeEntityMutation,
  normalizeKnowledgeSurfaceNode,
  noteDocToKnowledgeFile,
  removeKnowledgeFileSubtrees,
  childProjects as getChildProjects,
  projectHubHref,
  projectItemHref,
  projectRouteViewForFile,
  rootProjects as getRootProjects,
  sortProjectChats,
  sortProjectFilesByUpdated,
  type ProjectChatSummary,
  type ProjectFileSummary,
  type ProjectHubTab,
  type ProjectMetaUpdatedDetail,
  type ProjectSummary,
  type NoteDoc,
} from '@overlay/app-core'
import {
  ProjectHubActions,
  ProjectHubHeader,
  ProjectHubTabs,
} from '@overlay/modules-react/projects'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { FileViewerSkeleton } from '@overlay/ui/feedback'
import dynamic from 'next/dynamic'
import { FileViewerPanel, isEditableType } from '@overlay/modules-react/knowledge'
import { FileShareMenu } from '@/features/files/components/FileShareMenu'
import { ShareDialog } from '@/features/share/components/ShareDialog'
import { buildSharePageUrl } from '@/shared/share/share-page-url'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useWorkspaceChanged } from '@/features/workspaces/lib/use-workspace-changed'

type HubChat = ProjectChatSummary
type ProjectFileRecord = ProjectFileSummary

const ChatSuspenseBoundary = dynamic(() => import('@/features/chat/components/ChatSuspenseBoundary'))
const NotebookEditor = dynamic(() => import('@/features/notebook/components/NotebookEditor'))
const nextProjectFileMutation = createKnowledgeMutationPublisher(
  `web-project:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
)

// ─── File viewer fetched by ID ────────────────────────────────────────────────

function ProjectFileView({ fileId }: { fileId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [file, setFile] = useState<ProjectFileRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [fileContent, setFileContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    const timeoutId = setTimeout(() => {
      setLoading(true)
      overlayAppClient.files.get<ProjectFileRecord>({ fileId })
        .then((data) => {
          if (cancelled) return
          if (projectRouteViewForFile(data) === 'note') {
            const p = new URLSearchParams(searchParams?.toString() ?? '')
            p.set('view', 'note')
            p.set('id', fileId)
            router.replace(`/app/projects?${p.toString()}`)
            return
          }
          setFile(data)
          setFileContent(data.textContent ?? data.content ?? '')
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) {
            setLoading(false)
          }
        })
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [fileId, router, searchParams])

  function handleContentChange(val: string) {
    setFileContent(val)
    if (!file) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setIsSaving(true)
      await overlayAppClient.files.updateResponse({ fileId, textContent: val })
      setIsSaving(false)
    }, 800)
  }

  if (loading) {
    return <FileViewerSkeleton />
  }
  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#aaa] text-sm">
        File not found
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <FileViewerPanel
        name={file.name}
        content={fileContent}
        isSaving={isSaving}
        isEditable={isEditableType(file.name)}
        onContentChange={handleContentChange}
        headerRight={
          <FileShareMenu
            fileId={file._id}
            title={file.name}
            initialShareVisibility={file.shareVisibility ?? 'private'}
            initialShareUrl={
              file.shareVisibility === 'public' && file.shareToken
                ? buildSharePageUrl('file', file.shareToken)
                : null
            }
            renderShareDialog={(props) => <ShareDialog {...props} />}
          />
        }
      />
    </div>
  )
}

// ─── Project hub: ChatInterface + Chats / Files / Instructions tabs ──────────

function ProjectHubBody({
  projectId,
  projectName,
  userId,
  firstName,
}: {
  projectId: string
  projectName: string
  userId: string
  firstName?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<ProjectHubTab>('chats')
  const [chats, setChats] = useState<HubChat[]>([])
  const [files, setFiles] = useState<ProjectFileRecord[]>([])
  const [listsLoading, setListsLoading] = useState(true)

  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(projectName)
  const [savingName, setSavingName] = useState(false)
  useEffect(() => { setDraftName(projectName) }, [projectName])

  const [instructions, setInstructions] = useState<string>('')
  const [instructionsLoaded, setInstructionsLoaded] = useState(false)
  const [savingInstructions, setSavingInstructions] = useState(false)
  const [instructionsSavedAt, setInstructionsSavedAt] = useState<number | null>(null)
  const instructionsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load project instructions
  useEffect(() => {
    let cancelled = false
    setInstructionsLoaded(false)
    overlayAppClient.projects.get<{ instructions?: string } | null>({ projectId })
      .then((data: { instructions?: string } | null) => {
        if (cancelled) return
        setInstructions((data?.instructions ?? '') as string)
        setInstructionsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setInstructionsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const loadHubItems = useCallback(async () => {
    setListsLoading(true)
    try {
      const [chatsJson, filesJson] = await Promise.all([
        overlayAppClient.conversations.get<ProjectChatSummary[]>({ projectId, limit: 100 }),
        overlayAppClient.files.get<ProjectFileRecord[]>({ projectId, limit: 100, summary: true }),
      ])
      setChats(Array.isArray(chatsJson) ? chatsJson : [])
      setFiles(Array.isArray(filesJson) ? filesJson : [])
    } finally {
      setListsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadHubItems()
  }, [loadHubItems])

  useEffect(() => {
    function onChatCreated(e: Event) {
      const { detail } = e as CustomEvent<ChatCreatedDetail>
      if (!detail?.chat?._id) return
      setChats((current) => current.some((chat) => chat._id === detail.chat!._id)
        ? current.map((chat) => chat._id === detail.chat!._id ? detail.chat! : chat)
        : [...current, detail.chat])
    }
    function onChatDeleted(e: Event) {
      const { detail } = e as CustomEvent<ChatDeletedDetail>
      if (!detail?.chatId) return
      setChats((prev) => prev.filter((c) => c._id !== detail.chatId))
    }
    function onTitleUpdated(e: Event) {
      const { detail } = e as CustomEvent<ChatTitleUpdatedDetail>
      if (!detail?.chatId) return
      setChats((prev) =>
        prev.map((c) => (c._id === detail.chatId ? { ...c, title: detail.title } : c)),
      )
    }
    function onProjectMeta(e: Event) {
      const d = (e as CustomEvent<ProjectMetaUpdatedDetail>).detail
      if (d?.projectId !== projectId || !d.name) return
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('projectName', d.name)
      router.replace(`${pathname}?${params}`)
      setDraftName(d.name)
    }
    window.addEventListener(CHAT_CREATED_EVENT, onChatCreated)
    window.addEventListener(CHAT_DELETED_EVENT, onChatDeleted)
    window.addEventListener(CHAT_TITLE_UPDATED_EVENT, onTitleUpdated)
    const consumer = new KnowledgeMutationConsumer({
      origin: 'web-project-consumer',
      repository: {
        async list(signal) {
          const rows = await overlayAppClient.files.get<ProjectFileRecord[]>({ projectId, limit: 100, summary: true }, { signal })
          return {
            nodes: (Array.isArray(rows) ? rows : []).map((file) => normalizeKnowledgeSurfaceNode({
              ...file,
              createdAt: file.updatedAt ?? 0,
            })),
          }
        },
        async get() { return null },
      },
      async loadNode(mutation, signal) {
        if (mutation.entity === 'note') {
          const note = await overlayAppClient.notes.get<NoteDoc>({ noteId: mutation.id }, { signal })
          return normalizeKnowledgeSurfaceNode(noteDocToKnowledgeFile(note))
        }
        const response = await overlayAppClient.files.getResponse({ fileId: mutation.id }, { signal })
        if (response.status === 404) return null
        if (!response.ok) throw new Error('Could not update project file')
        return normalizeKnowledgeSurfaceNode(await response.json())
      },
      apply(event) {
        if (event.type === 'reset') setFiles([...event.nodes])
        else if (event.type === 'created' || event.type === 'updated') {
          setFiles((current) => {
            const exists = current.some((file) => file._id === event.node.id)
            if (!exists && event.node.projectId !== projectId) return current
            return exists
              ? current.map((file) => file._id === event.node.id ? event.node : file)
              : [...current, event.node]
          })
        } else if (event.type === 'deleted') {
          setFiles((current) => removeKnowledgeFileSubtrees(current, event.ids))
        }
      },
    })
    const onKnowledgeMutation = (event: Event) => {
      const mutation = (event as CustomEvent<unknown>).detail
      if (isKnowledgeEntityMutation(mutation)) void consumer.handle(mutation).catch(() => undefined)
    }
    const onKnowledgeReconcile = () => { void consumer.reconcile('explicit-refresh').catch(() => undefined) }
    const onOnline = () => { void consumer.reconcile('reconnected').catch(() => undefined) }
    window.addEventListener(KNOWLEDGE_ENTITY_MUTATION_EVENT, onKnowledgeMutation)
    window.addEventListener(KNOWLEDGE_RECONCILE_EVENT, onKnowledgeReconcile)
    window.addEventListener('online', onOnline)
    window.addEventListener(PROJECT_META_UPDATED_EVENT, onProjectMeta)
    return () => {
      window.removeEventListener(CHAT_CREATED_EVENT, onChatCreated)
      window.removeEventListener(CHAT_DELETED_EVENT, onChatDeleted)
      window.removeEventListener(CHAT_TITLE_UPDATED_EVENT, onTitleUpdated)
      consumer.dispose()
      window.removeEventListener(KNOWLEDGE_ENTITY_MUTATION_EVENT, onKnowledgeMutation)
      window.removeEventListener(KNOWLEDGE_RECONCILE_EVENT, onKnowledgeReconcile)
      window.removeEventListener('online', onOnline)
      window.removeEventListener(PROJECT_META_UPDATED_EVENT, onProjectMeta)
    }
  }, [pathname, projectId, router, searchParams])

  async function commitProjectRename() {
    setEditingName(false)
    const name = draftName.trim()
    if (!name || name === projectName) {
      setDraftName(projectName)
      return
    }
    setSavingName(true)
    try {
      const res = await overlayAppClient.projects.updateResponse({ projectId, name })
      if (!res.ok) {
        setDraftName(projectName)
        return
      }
      const data = (await res.json().catch(() => ({}))) as { project?: { name?: string } }
      const finalName = data.project?.name?.trim() || name
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('projectName', finalName)
      router.replace(`${pathname}?${params}`)
      window.dispatchEvent(
        new CustomEvent(PROJECT_META_UPDATED_EVENT, { detail: { projectId, name: finalName } }),
      )
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
      setDraftName(finalName)
    } finally {
      setSavingName(false)
    }
  }

  async function createChat() {
    const res = await overlayAppClient.conversations.createResponse({ projectId, title: 'New Chat' })
    if (!res.ok) return
    const data = (await res.json()) as { id?: string }
    if (!data.id) return
    setChats((current) => [...current, { _id: data.id!, title: 'New Chat', updatedAt: Date.now() }])
    router.push(projectItemHref({ project: { _id: projectId, name: projectName }, view: 'chat', id: data.id }))
  }

  async function createNote() {
    const res = await overlayAppClient.files.createResponse(createProjectNoteRequest(projectId))
    if (!res.ok) return
    const data = (await res.json()) as { id?: string }
    if (!data.id) return
    window.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
      detail: nextProjectFileMutation({ entity: 'note', id: data.id, operation: 'created' }),
    }))
    router.push(projectItemHref({ project: { _id: projectId, name: projectName }, view: 'note', id: data.id }))
  }

  function openChat(id: string) {
    router.push(projectItemHref({ project: { _id: projectId, name: projectName }, view: 'chat', id }))
  }
  function openFile(file: ProjectFileRecord) {
    router.push(projectItemHref({ project: { _id: projectId, name: projectName }, view: projectRouteViewForFile(file), id: file._id }))
  }

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function uploadFiles(filesIn: FileList | null) {
    if (!filesIn || filesIn.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(filesIn)) {
        const form = new FormData()
        form.append('file', file)
        form.append('projectId', projectId)
        const response = await overlayAppClient.files.ingestDocumentResponse(form).catch(() => null)
        if (!response?.ok) continue
        const body = await response.json().catch(() => null) as { id?: string; file?: { _id?: string } } | null
        const id = body?.file?._id ?? body?.id
        if (id) {
          window.dispatchEvent(new CustomEvent(KNOWLEDGE_ENTITY_MUTATION_EVENT, {
            detail: nextProjectFileMutation({ entity: 'file', id, operation: 'created' }),
          }))
        }
      }
    } finally {
      setUploading(false)
    }
  }

  function onInstructionsChange(val: string) {
    setInstructions(val)
    if (instructionsSaveTimer.current) clearTimeout(instructionsSaveTimer.current)
    instructionsSaveTimer.current = setTimeout(async () => {
      setSavingInstructions(true)
      try {
        const res = await overlayAppClient.projects.updateResponse({ projectId, instructions: val })
        if (res.ok) setInstructionsSavedAt(Date.now())
      } finally {
        setSavingInstructions(false)
      }
    }, 700)
  }

  // Header actions: + dropdown, Upload dropdown
  const [plusOpen, setPlusOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const plusRef = useRef<HTMLDivElement>(null)
  const uploadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onClick(e: globalThis.MouseEvent) {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false)
      if (uploadRef.current && !uploadRef.current.contains(e.target as Node)) setUploadOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  const headerActions = (
    <ProjectHubActions
      creatingOpen={plusOpen}
      uploadOpen={uploadOpen}
      uploading={uploading}
      plusRef={plusRef}
      uploadRef={uploadRef}
      fileInputRef={fileInputRef}
      folderInputRef={folderInputRef}
      onToggleCreate={() => { setPlusOpen((value) => !value); setUploadOpen(false) }}
      onToggleUpload={() => { setUploadOpen((value) => !value); setPlusOpen(false) }}
      onCreateChat={() => { setPlusOpen(false); void createChat() }}
      onCreateNote={() => { setPlusOpen(false); void createNote() }}
      onUploadFiles={(event) => { void uploadFiles(event.target.files); event.currentTarget.value = '' }}
      onUploadFolder={(event) => { void uploadFiles(event.target.files); event.currentTarget.value = '' }}
    />
  )

  const projectHeaderTitle = (
    <ProjectHubHeader
      projectName={projectName}
      editingName={editingName}
      draftName={draftName}
      savingName={savingName}
      actions={headerActions}
      onBack={() => { router.push('/app/projects') }}
      onStartRename={() => { setDraftName(projectName); setEditingName(true) }}
      onDraftNameChange={setDraftName}
      onCommitRename={() => void commitProjectRename()}
      onCancelRename={() => { setDraftName(projectName); setEditingName(false) }}
    />
  )

  const sortedChats = useMemo(
    () => sortProjectChats(chats),
    [chats],
  )
  const sortedFiles = useMemo(
    () => sortProjectFilesByUpdated(files),
    [files],
  )

  const tabs = (
    <ProjectHubTabs
      activeTab={activeTab}
      chats={sortedChats}
      files={sortedFiles}
      listsLoading={listsLoading}
      instructions={instructions}
      instructionsLoaded={instructionsLoaded}
      savingInstructions={savingInstructions}
      instructionsSavedAt={instructionsSavedAt}
      onTabChange={setActiveTab}
      onOpenChat={openChat}
      onOpenFile={openFile}
      onInstructionsChange={onInstructionsChange}
    />
  )

  return (
    <AppScreenShell header={projectHeaderTitle}>
      <AppScreenBody padding="none" maxWidth="none" scroll="hidden">
        <ChatSuspenseBoundary
          userId={userId}
          firstName={firstName}
          hideSidebar
          hideHeader
          projectName={projectName}
          belowEmptyComposer={tabs}
        />
      </AppScreenBody>
    </AppScreenShell>
  )
}

// ─── Projects landing (no projectId) ─────────────────────────────────────────

function formatProjectUpdatedAt(updatedAt: number): string {
  if (!Number.isFinite(updatedAt)) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(updatedAt))
}

function ProjectRenameInput({
  projectName,
  saving,
  error,
  onCommit,
  onCancel,
  onChange,
}: {
  projectName: string
  saving: boolean
  error: string | null
  onCommit: (name: string) => void
  onCancel: () => void
  onChange: () => void
}) {
  const [draftName, setDraftName] = useState(projectName)
  const cancelledRef = useRef(false)

  const commit = () => {
    if (cancelledRef.current || saving) return
    onCommit(draftName)
  }

  return (
    <div className="min-w-0">
      <input
        autoFocus
        aria-label="Project name"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'project-rename-error' : undefined}
        value={draftName}
        readOnly={saving}
        onChange={(event) => {
          setDraftName(event.target.value)
          onChange()
        }}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
          if (event.key === 'Escape' && !saving) {
            event.preventDefault()
            cancelledRef.current = true
            onCancel()
          }
        }}
        onBlur={commit}
        className="w-full truncate rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-sm font-medium text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)] read-only:opacity-70"
      />
      {error ? (
        <p id="project-rename-error" role="alert" className="mt-1 text-[11px] leading-4 text-red-500">
          {error}
        </p>
      ) : null}
    </div>
  )
}

const tileMenuButtonClass =
  'flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]'

function ProjectTileMenu({
  projectName,
  archived,
  onRename,
  onSetArchived,
}: {
  projectName: string
  archived: boolean
  onRename: () => void
  onSetArchived: (archived: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(event: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [open])

  return (
    <div ref={menuRef} className="absolute right-3 top-3 z-10">
      <button
        type="button"
        aria-label={`Project options for ${projectName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-light)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
      >
        <MoreVertical size={14} strokeWidth={1.75} />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-8 w-36 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-lg">
          <button
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              onRename()
            }}
            className={tileMenuButtonClass}
          >
            <Pencil size={13} strokeWidth={1.75} className="shrink-0 text-[var(--muted)]" />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              onSetArchived(!archived)
            }}
            className={tileMenuButtonClass}
          >
            {archived
              ? <ArchiveRestore size={13} strokeWidth={1.75} className="shrink-0 text-[var(--muted)]" />
              : <Archive size={13} strokeWidth={1.75} className="shrink-0 text-[var(--muted)]" />}
            {archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ProjectsLanding({
  projects,
  loading,
  creating,
  archived,
  onCreateProject,
  renamingProjectId,
  renamingProjectPending,
  renameError,
  onCommitRename,
  onCancelRename,
  onRenameChange,
  onStartRename,
  onSetProjectArchived,
}: {
  projects: readonly ProjectSummary[]
  loading: boolean
  creating: boolean
  archived: boolean
  onCreateProject: () => void
  renamingProjectId: string | null
  renamingProjectPending: boolean
  renameError: string | null
  onCommitRename: (projectId: string, name: string) => void
  onCancelRename: () => void
  onRenameChange: () => void
  onStartRename: (projectId: string) => void
  onSetProjectArchived: (projectId: string, archived: boolean) => void
}) {
  const router = useRouter()
  const rootProjectRows = useMemo(() => {
    const roots = getRootProjects(projects)
    return roots.length > 0 ? roots : [...projects]
  }, [projects])

  return (
    <AppScreenShell
      header={
        <AppScreenHeader
          title="Projects"
          className="px-3 py-2.5 md:px-4 md:py-0"
          actions={
            <button
              type="button"
              onClick={onCreateProject}
              disabled={creating}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              New project
            </button>
          }
        />
      }
    >
      <AppScreenBody padding="none" maxWidth="none" className="px-5 py-5">
        {loading && projects.length === 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
                <div className="ui-skeleton-line mb-4 h-8 w-8 rounded-md" />
                <div className="ui-skeleton-line mb-2 h-3.5 w-36 rounded" />
                <div className="ui-skeleton-line h-3 w-2/3 rounded opacity-75" />
              </div>
            ))}
          </div>
        ) : rootProjectRows.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rootProjectRows.map((project) => {
              const subprojectCount = getChildProjects(projects, project._id).length
              const updatedLabel = formatProjectUpdatedAt(project.updatedAt)
              const isRenaming = renamingProjectId === project._id
              const content = (
                <>
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)]">
                      <Folder size={16} strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1 pr-6">
                      {isRenaming ? (
                        <ProjectRenameInput
                          projectName={project.name}
                          saving={renamingProjectPending}
                          error={renameError}
                          onCommit={(name) => onCommitRename(project._id, name)}
                          onCancel={onCancelRename}
                          onChange={onRenameChange}
                        />
                      ) : (
                        <p className="truncate text-sm font-medium text-[var(--foreground)]">{project.name}</p>
                      )}
                      {project.description || project.instructions ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">
                          {project.description || project.instructions}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-[var(--muted)]">Project workspace</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-3 text-[11px] text-[var(--muted-light)]">
                    <span>{subprojectCount > 0 ? `${subprojectCount} nested project${subprojectCount === 1 ? '' : 's'}` : 'Project'}</span>
                    {updatedLabel ? <span>Updated {updatedLabel}</span> : null}
                  </div>
                </>
              )

              return (
                <div
                  key={project._id}
                  className={`group relative flex min-h-32 flex-col justify-between rounded-lg border p-4 text-left transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-[var(--foreground)] ${
                    isRenaming
                      ? 'border-[var(--muted-light)] bg-[var(--surface-subtle)]'
                      : 'border-[var(--border)] bg-[var(--surface-elevated)] hover:border-[var(--muted-light)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  {isRenaming ? (
                    <div className="flex flex-1 flex-col justify-between">{content}</div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => router.push(projectHubHref(project))}
                      className="flex flex-1 cursor-pointer flex-col justify-between rounded-lg text-left"
                    >
                      {content}
                    </button>
                  )}
                  <ProjectTileMenu
                    projectName={project.name}
                    archived={archived}
                    onRename={() => {
                      onRenameChange()
                      onStartRename(project._id)
                    }}
                    onSetArchived={(nextArchived) => onSetProjectArchived(project._id, nextArchived)}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6">
            <p className="text-sm text-[var(--muted)]">{archived ? 'No archived projects.' : 'No projects yet.'}</p>
          </div>
        )}
      </AppScreenBody>
    </AppScreenShell>
  )
}

// ─── ProjectsView ─────────────────────────────────────────────────────────────

export default function ProjectsView({
  userId,
  firstName,
  initialProjects = [],
  initialArchived = false,
}: {
  userId: string
  firstName?: string
  initialProjects?: ProjectSummary[]
  /** Whether `initialProjects` is the archived list (server-rendered deep link). */
  initialArchived?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [projects, setProjects] = useState<ProjectSummary[]>(initialProjects)
  const [projectsLoading, setProjectsLoading] = useState(initialProjects.length === 0)
  const [creatingProject, setCreatingProject] = useState(false)
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [renamingProjectPending, setRenamingProjectPending] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameRequestRef = useRef(false)
  const skipInitialFetchRef = useRef(initialProjects.length > 0)
  const view = searchParams?.get('view') ?? null
  const id = searchParams?.get('id') ?? null
  const projectId = searchParams?.get('projectId') ?? null
  const archivedView = searchParams?.get('archived') === '1'
  const renameProjectParam = searchParams?.get('rename') ?? null
  const initialProject = projectId ? projects.find((project) => project._id === projectId) : undefined
  const projectName = searchParams?.get('projectName') ?? initialProject?.name ?? undefined

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true)
    try {
      // Omit the flag when listing active projects: the BFF defaults to them
      // and existing Convex deployments tolerate the missing argument best.
      const data = await overlayAppClient.projects.get<ProjectSummary[]>({ limit: 100, archived: archivedView || undefined })
      setProjects(Array.isArray(data) ? data : [])
    } finally {
      setProjectsLoading(false)
    }
  }, [archivedView])

  const setParams = useCallback((apply: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    apply(params)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }, [pathname, router, searchParams])

  useEffect(() => {
    if (initialProjects.length > 0) {
      setProjects(initialProjects)
      setProjectsLoading(false)
    }
  }, [initialProjects])

  useEffect(() => {
    // Skip the initial mount fetch when server-rendered data matching the
    // current filter is already present. The loadProjects() call would
    // duplicate the BFF request that the server already made. Switching the
    // All/Archived filter always refetches because the SSR list was for the
    // other filter.
    const skipInitialFetch = skipInitialFetchRef.current && archivedView === initialArchived
    skipInitialFetchRef.current = false
    function onProjectsChanged() {
      void loadProjects()
    }
    window.addEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged)
    if (!skipInitialFetch) {
      void loadProjects()
    }
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged)
  }, [archivedView, initialArchived, loadProjects])

  // A fresh project created from the sidebar lands here with ?rename=<id>;
  // once it shows up in the loaded list, put its tile straight into rename
  // with the text selected and clean the param back out of the URL.
  useEffect(() => {
    if (!renameProjectParam) return
    if (!projects.some((project) => project._id === renameProjectParam)) return
    setRenameError(null)
    setRenamingProjectId(renameProjectParam)
    setParams((params) => params.delete('rename'))
  }, [projects, renameProjectParam, setParams])

  useWorkspaceChanged(loadProjects)

  const createProject = useCallback(async () => {
    if (creatingProject) return
    setCreatingProject(true)
    try {
      const res = await overlayAppClient.projects.createResponse({ name: 'Untitled project' })
      if (!res.ok) return
      const data = (await res.json().catch(() => ({}))) as {
        id?: string
        project?: Partial<ProjectSummary> & { _id?: string; name?: string }
      }
      const created = data.project
      if (created?._id && typeof created.createdAt === 'number' && typeof created.updatedAt === 'number') {
        setProjects((prev) => [created as ProjectSummary, ...prev.filter((project) => project._id !== created._id)])
      } else {
        void loadProjects()
      }
      const createdId = created?._id || data.id
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
      if (createdId) {
        setRenameError(null)
        setRenamingProjectId(createdId)
        // The archived grid hides the fresh project; land back on All so the
        // rename input is actually visible.
        if (archivedView) {
          setParams((params) => params.delete('archived'))
        }
      }
    } finally {
      setCreatingProject(false)
    }
  }, [archivedView, creatingProject, loadProjects, setParams])

  const setProjectArchived = useCallback(async (targetProjectId: string, archived: boolean) => {
    try {
      const response = await overlayAppClient.projects.updateResponse({ projectId: targetProjectId, archived })
      if (!response.ok) return
      setProjects((prev) => prev.map((project) => (
        project._id === targetProjectId
          ? { ...project, archivedAt: archived ? Date.now() : null }
          : project
      )))
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
    } catch {
      // Leave the tile as-is; the next projects reload reflects the real state.
    }
  }, [])

  if (view === 'chat' && id) {
    return (
      <ChatSuspenseBoundary userId={userId} firstName={firstName} hideSidebar projectName={projectName} />
    )
  }

  if (view === 'note' && id) {
    return <NotebookEditor userId={userId} hideSidebar projectName={projectName} />
  }

  if (view === 'file' && id) {
    return <ProjectFileView fileId={id} />
  }

  if (projectId?.trim()) {
    return (
      <ProjectHubBody
        projectId={projectId.trim()}
        projectName={projectName?.trim() || 'Project'}
        userId={userId}
        firstName={firstName}
      />
    )
  }

  return (
    <ProjectsLanding
      projects={projects}
      loading={projectsLoading}
      creating={creatingProject}
      archived={archivedView}
      onCreateProject={() => void createProject()}
      renamingProjectId={renamingProjectId}
      renamingProjectPending={renamingProjectPending}
      renameError={renameError}
      onStartRename={(startProjectId) => setRenamingProjectId(startProjectId)}
      onCommitRename={async (projectId, name) => {
        const trimmed = name.trim()
        if (!trimmed) {
          setRenameError('Enter a project name.')
          return
        }
        if (renameRequestRef.current) return
        const currentProject = projects.find((project) => project._id === projectId)
        if (trimmed === currentProject?.name) {
          setRenameError(null)
          setRenamingProjectId(null)
          return
        }

        renameRequestRef.current = true
        setRenamingProjectPending(true)
        setRenameError(null)
        try {
          const response = await overlayAppClient.projects.updateResponse({ projectId, name: trimmed })
          const payload = (await response.json().catch(() => null)) as
            | { error?: string; message?: string; project?: ProjectSummary | null }
            | null
          if (!response.ok) {
            setRenameError(payload?.message || payload?.error || 'Could not rename this project. Try again.')
            return
          }
          const finalName = payload?.project?.name?.trim() || trimmed
          setProjects((prev) => prev.map((project) => (
            project._id === projectId ? { ...project, ...payload?.project, name: finalName } : project
          )))
          setRenamingProjectId(null)
          window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
        } catch {
          setRenameError('Could not rename this project. Check your connection and try again.')
        } finally {
          renameRequestRef.current = false
          setRenamingProjectPending(false)
        }
      }}
      onCancelRename={() => {
        setRenameError(null)
        setRenamingProjectId(null)
      }}
      onRenameChange={() => setRenameError(null)}
      onSetProjectArchived={(archiveProjectId, nextArchived) => void setProjectArchived(archiveProjectId, nextArchived)}
    />
  )
}
