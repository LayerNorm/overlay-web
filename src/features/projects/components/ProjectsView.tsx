'use client'

// Web host adapter: Next routing and browser transport stay at the platform
// boundary while reusable project and file presentation lives in @overlay/modules-react.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  Archive,
  BookOpen,
  FilePlus2,
  Folder,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react'
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
  type KnowledgeBase,
} from '@overlay/app-core'
import {
  ProjectHubHeader,
  ProjectHubModeControl,
  ProjectHubTabs,
} from '@overlay/modules-react/projects'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { FileViewerSkeleton } from '@overlay/ui/feedback'
import { SegmentedControl } from '@overlay/ui'
import dynamic from 'next/dynamic'
import { FileViewerPanel, isEditableType } from '@overlay/modules-react/knowledge'
import { FileShareMenu } from '@/features/files/components/FileShareMenu'
import { ShareDialog } from '@/features/share/components/ShareDialog'
import { buildSharePageUrl } from '@/shared/share/share-page-url'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

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
  const requestedTab = searchParams?.get('tab')
  const [activeTab, setActiveTab] = useState<ProjectHubTab>(
    requestedTab === 'files' || requestedTab === 'settings' ? requestedTab : 'chat',
  )
  const [chats, setChats] = useState<HubChat[]>([])
  const [files, setFiles] = useState<ProjectFileRecord[]>([])
  const [listsLoading, setListsLoading] = useState(true)

  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(projectName)
  const [savingName, setSavingName] = useState(false)
  useEffect(() => { setDraftName(projectName) }, [projectName])
  useEffect(() => {
    setActiveTab(requestedTab === 'files' || requestedTab === 'settings' ? requestedTab : 'chat')
  }, [requestedTab])

  const [instructions, setInstructions] = useState<string>('')
  const [instructionsLoaded, setInstructionsLoaded] = useState(false)
  const [savingInstructions, setSavingInstructions] = useState(false)
  const [instructionsSavedAt, setInstructionsSavedAt] = useState<number | null>(null)
  const instructionsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [attachedKnowledgeBaseIds, setAttachedKnowledgeBaseIds] = useState<string[]>([])
  const [knowledgeBaseSettingsLoaded, setKnowledgeBaseSettingsLoaded] = useState(false)
  const [savingKnowledgeBase, setSavingKnowledgeBase] = useState(false)
  const [knowledgeBaseError, setKnowledgeBaseError] = useState<string | null>(null)
  const [archivedAt, setArchivedAt] = useState<number | null>(null)
  const [changingLifecycle, setChangingLifecycle] = useState(false)

  // Load project instructions
  useEffect(() => {
    let cancelled = false
    setInstructionsLoaded(false)
    setKnowledgeBaseSettingsLoaded(false)
    void Promise.allSettled([
      overlayAppClient.projects.get<ProjectSummary | null>({ projectId }),
      overlayAppClient.knowledgeBases.list(),
      overlayAppClient.projects.listKnowledgeBases({ projectId }),
    ]).then(([projectResult, knowledgeResult, attachedResult]) => {
      if (cancelled) return
      if (projectResult.status === 'fulfilled') {
        const project = projectResult.value
        setInstructions(project?.instructions ?? '')
        setArchivedAt(project?.archivedAt ?? null)
      }
      if (knowledgeResult.status === 'fulfilled') {
        setKnowledgeBases(knowledgeResult.value.knowledgeBases)
      }
      if (attachedResult.status === 'fulfilled') {
        setAttachedKnowledgeBaseIds(attachedResult.value.knowledgeBases.map(({ id }) => id))
      } else if (projectResult.status === 'fulfilled' && projectResult.value?.knowledgeBaseId) {
        // Projects created before multi-attach still carry a single column.
        setAttachedKnowledgeBaseIds([projectResult.value.knowledgeBaseId])
      }
      setInstructionsLoaded(true)
      setKnowledgeBaseSettingsLoaded(true)
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

  async function createNote() {
    const res = await overlayAppClient.notes.createResponse({
      title: 'Untitled',
      content: '',
      projectId,
    })
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

  async function attachKnowledgeBase(knowledgeBaseId: string) {
    if (savingKnowledgeBase || !knowledgeBaseId) return
    if (attachedKnowledgeBaseIds.includes(knowledgeBaseId)) return
    setSavingKnowledgeBase(true)
    setKnowledgeBaseError(null)
    try {
      await overlayAppClient.projects.attachKnowledgeBase({ projectId, knowledgeBaseId })
      setAttachedKnowledgeBaseIds((current) => (
        current.includes(knowledgeBaseId) ? current : [...current, knowledgeBaseId]
      ))
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
    } catch (error) {
      setKnowledgeBaseError(error instanceof Error ? error.message : 'Failed to attach knowledge base')
    } finally {
      setSavingKnowledgeBase(false)
    }
  }

  async function detachKnowledgeBase(knowledgeBaseId: string) {
    if (savingKnowledgeBase) return
    setSavingKnowledgeBase(true)
    setKnowledgeBaseError(null)
    try {
      await overlayAppClient.projects.detachKnowledgeBase({ projectId, knowledgeBaseId })
      setAttachedKnowledgeBaseIds((current) => current.filter((id) => id !== knowledgeBaseId))
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
    } catch (error) {
      setKnowledgeBaseError(error instanceof Error ? error.message : 'Failed to detach knowledge base')
    } finally {
      setSavingKnowledgeBase(false)
    }
  }

  async function setProjectArchived(archived: boolean) {
    if (changingLifecycle) return
    setChangingLifecycle(true)
    try {
      const response = await overlayAppClient.projects.updateResponse({ projectId, archived })
      if (!response.ok) return
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
      if (archived) {
        router.replace('/app/projects?archived=1')
      } else {
        setArchivedAt(null)
      }
    } finally {
      setChangingLifecycle(false)
    }
  }

  async function deleteProject() {
    if (changingLifecycle || !window.confirm('Delete this project and its chats and working files?')) return
    setChangingLifecycle(true)
    try {
      const response = await overlayAppClient.projects.deleteResponse({ projectId })
      if (!response.ok) return
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
      router.replace('/app/projects')
    } finally {
      setChangingLifecycle(false)
    }
  }

  const handleTabChange = useCallback((tab: ProjectHubTab) => {
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (tab === 'chat') params.delete('tab')
    else params.set('tab', tab)
    params.delete('view')
    params.delete('id')
    router.replace(`${pathname}?${params.toString()}`)
  }, [pathname, router, searchParams])

  const attachedKnowledgeBases = useMemo(
    () => attachedKnowledgeBaseIds
      .map((id) => knowledgeBases.find((base) => base.id === id))
      .filter((base): base is KnowledgeBase => Boolean(base)),
    [attachedKnowledgeBaseIds, knowledgeBases],
  )
  const attachableKnowledgeBases = useMemo(
    () => knowledgeBases.filter(({ id }) => !attachedKnowledgeBaseIds.includes(id)),
    [attachedKnowledgeBaseIds, knowledgeBases],
  )
  const knowledgeScopeLabel = attachedKnowledgeBases.length === 1
    ? attachedKnowledgeBases[0]!.title
    : `${attachedKnowledgeBases.length} knowledge bases`
  const modeControl = (
    <ProjectHubModeControl activeTab={activeTab} onTabChange={handleTabChange} />
  )
  const contextControls = (
    <div className="ml-auto flex min-w-0 items-center gap-2">
      {attachedKnowledgeBases.length > 0 ? (
        <span
          className="hidden max-w-52 items-center gap-1.5 truncate text-xs text-[var(--muted)] sm:inline-flex"
          title={`Trusted knowledge: ${attachedKnowledgeBases.map(({ title }) => title).join(', ')}`}
          data-testid="project-active-knowledge-base"
        >
          <BookOpen size={13} className="shrink-0" />
          <span className="truncate">{knowledgeScopeLabel}</span>
        </span>
      ) : null}
      {modeControl}
    </div>
  )

  const projectHeaderTitle = (
    <ProjectHubHeader
      projectName={projectName}
      editingName={editingName}
      draftName={draftName}
      savingName={savingName}
      actions={contextControls}
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

  const fileActions = (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void createNote()}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--surface-subtle)] px-2.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)]"
      >
        <FilePlus2 size={13} />
        New
      </button>
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--surface-subtle)] px-2.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50"
      >
        {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
        Upload
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          void uploadFiles(event.target.files)
          event.currentTarget.value = ''
        }}
      />
    </div>
  )

  const knowledgeBaseSettings = (
    <div>
      <div className="mb-4">
        <h2 className="text-sm font-medium text-[var(--foreground)]">Trusted knowledge</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Attach reusable knowledge bases. Their enabled sources are available to every chat in this
          project, and answers cite them. Project working files stay separate as working material.
        </p>
      </div>
      {attachedKnowledgeBases.length > 0 ? (
        <ul className="mb-3 space-y-1.5" data-testid="project-knowledge-base-list">
          {attachedKnowledgeBases.map((base) => (
            <li
              key={base.id}
              className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2.5 py-2"
            >
              <BookOpen size={13} className="shrink-0 text-[var(--muted)]" />
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--foreground)]">{base.title}</span>
              <button
                type="button"
                disabled={savingKnowledgeBase}
                onClick={() => void detachKnowledgeBase(base.id)}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)] disabled:opacity-50"
                aria-label={`Detach ${base.title}`}
              >
                Detach
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="block text-xs font-medium text-[var(--foreground)]">
        Attach a knowledge base
        <select
          value=""
          disabled={
            !knowledgeBaseSettingsLoaded
            || savingKnowledgeBase
            || attachableKnowledgeBases.length === 0
          }
          onChange={(event) => {
            const next = event.target.value
            event.currentTarget.value = ''
            if (next) void attachKnowledgeBase(next)
          }}
          className="mt-1.5 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)] disabled:opacity-60"
          data-testid="project-knowledge-base-select"
        >
          <option value="">
            {attachableKnowledgeBases.length === 0 ? 'No more knowledge bases available' : 'Select…'}
          </option>
          {attachableKnowledgeBases.map((base) => (
            <option key={base.id} value={base.id}>{base.title}</option>
          ))}
        </select>
      </label>
      <p className="mt-2 min-h-4 text-[11px] text-[var(--muted-light)]">
        {savingKnowledgeBase
          ? 'Saving…'
          : knowledgeBaseError
            ? knowledgeBaseError
            : attachedKnowledgeBases.length > 0
              ? `${attachedKnowledgeBases.length} attached and active in Project Chat.`
              : 'Project working files remain available separately.'}
      </p>
    </div>
  )

  const lifecycleSettings = (
    <div>
      <h2 className="text-sm font-medium text-[var(--foreground)]">Project lifecycle</h2>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
        Archive preserves the workspace for later. Delete removes the project and its linked working data.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={changingLifecycle}
          onClick={() => void setProjectArchived(!archivedAt)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-3 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)] disabled:opacity-50"
        >
          {archivedAt ? <RotateCcw size={13} /> : <Archive size={13} />}
          {archivedAt ? 'Restore project' : 'Archive project'}
        </button>
        <button
          type="button"
          disabled={changingLifecycle}
          onClick={() => void deleteProject()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-500/30 px-3 text-xs text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
        >
          <Trash2 size={13} />
          Delete project
        </button>
      </div>
    </div>
  )

  const tabContent = (
    <ProjectHubTabs
      activeTab={activeTab}
      chats={sortedChats}
      files={sortedFiles}
      listsLoading={listsLoading}
      instructions={instructions}
      instructionsLoaded={instructionsLoaded}
      savingInstructions={savingInstructions}
      instructionsSavedAt={instructionsSavedAt}
      fileActions={fileActions}
      knowledgeBaseSettings={knowledgeBaseSettings}
      lifecycleSettings={lifecycleSettings}
      onOpenChat={openChat}
      onOpenFile={openFile}
      onInstructionsChange={onInstructionsChange}
    />
  )

  if (activeTab === 'chat') {
    return (
      <ChatSuspenseBoundary
        userId={userId}
        firstName={firstName}
        hideSidebar
        projectName={projectName}
        contextNavigation={contextControls}
        belowEmptyComposer={tabContent}
      />
    )
  }

  return (
    <AppScreenShell header={projectHeaderTitle}>
      <AppScreenBody padding="md" maxWidth="xl">
        {tabContent}
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

function ProjectsLanding({
  projects,
  loading,
  creating,
  showArchived,
  onCreateProject,
  onRestoreProject,
  onShowArchivedChange,
}: {
  projects: readonly ProjectSummary[]
  loading: boolean
  creating: boolean
  showArchived: boolean
  onCreateProject: () => void
  onRestoreProject: (projectId: string) => void
  onShowArchivedChange: (showArchived: boolean) => void
}) {
  const router = useRouter()
  const rootProjectRows = useMemo(() => {
    const visible = projects.filter((project) => showArchived
      ? Boolean(project.archivedAt)
      : !project.archivedAt)
    const roots = getRootProjects(visible)
    return roots.length > 0 ? roots : visible
  }, [projects, showArchived])

  return (
    <AppScreenShell
      header={
        <AppScreenHeader
          title="Projects"
          className="px-3 py-2.5 md:px-4 md:py-0"
          actions={
            <>
              <SegmentedControl
                value={showArchived ? 'archived' : 'active'}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'archived', label: 'Archived' },
                ]}
                onChange={(value) => onShowArchivedChange(value === 'archived')}
                ariaLabel="Project lifecycle"
              />
              {!showArchived ? (
                <button
                  type="button"
                  onClick={onCreateProject}
                  disabled={creating}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--surface-subtle)] px-3 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50"
                >
                  {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  New
                </button>
              ) : null}
            </>
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
              return (
                <div
                  key={project._id}
                  className="group flex min-h-32 flex-col justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4 text-left transition-colors hover:border-[var(--muted-light)] hover:bg-[var(--surface-subtle)]"
                >
                  <button
                    type="button"
                    onClick={() => router.push(showArchived
                      ? `${projectHubHref(project)}&tab=settings`
                      : projectHubHref(project))}
                    className="flex min-w-0 items-start gap-3 text-left"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)]">
                      <Folder size={16} strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">{project.name}</p>
                      {project.description || project.instructions ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">
                          {project.description || project.instructions}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-[var(--muted)]">Project workspace</p>
                      )}
                    </div>
                  </button>
                  <div className="mt-5 flex items-center justify-between gap-3 text-[11px] text-[var(--muted-light)]">
                    {showArchived ? (
                      <button
                        type="button"
                        onClick={() => onRestoreProject(project._id)}
                        className="inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--foreground)]"
                      >
                        <RotateCcw size={11} />
                        Restore
                      </button>
                    ) : (
                      <span>{subprojectCount > 0 ? `${subprojectCount} nested project${subprojectCount === 1 ? '' : 's'}` : 'Project'}</span>
                    )}
                    {updatedLabel ? <span>Updated {updatedLabel}</span> : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6">
            <p className="text-sm text-[var(--muted)]">
              {showArchived ? 'No archived projects.' : 'No projects yet.'}
            </p>
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
}: {
  userId: string
  firstName?: string
  initialProjects?: ProjectSummary[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [projects, setProjects] = useState<ProjectSummary[]>(initialProjects)
  const [projectsLoading, setProjectsLoading] = useState(initialProjects.length === 0)
  const [creatingProject, setCreatingProject] = useState(false)
  const view = searchParams?.get('view') ?? null
  const id = searchParams?.get('id') ?? null
  const projectId = searchParams?.get('projectId') ?? null
  const showArchived = searchParams?.get('archived') === '1'
  const initialProject = projectId ? projects.find((project) => project._id === projectId) : undefined
  const projectName = searchParams?.get('projectName') ?? initialProject?.name ?? undefined
  const navigateProjectMode = useCallback((tab: ProjectHubTab) => {
    if (!projectId) return
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('view')
    params.delete('id')
    if (tab === 'chat') params.delete('tab')
    else params.set('tab', tab)
    router.push(`/app/projects?${params.toString()}`)
  }, [projectId, router, searchParams])

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true)
    try {
      const data = await overlayAppClient.projects.get<ProjectSummary[]>({
        includeArchived: true,
        limit: 100,
      })
      setProjects(Array.isArray(data) ? data : [])
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProjects()
    function onProjectsChanged() {
      void loadProjects()
    }
    window.addEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged)
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged)
  }, [loadProjects])

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
      const createdName = created?.name || 'Untitled project'
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
      if (createdId) {
        router.push(projectHubHref({ _id: createdId, name: createdName }))
      }
    } finally {
      setCreatingProject(false)
    }
  }, [creatingProject, loadProjects, router])

  const restoreProject = useCallback(async (restoreProjectId: string) => {
    const response = await overlayAppClient.projects.updateResponse({
      projectId: restoreProjectId,
      archived: false,
    })
    if (!response.ok) return
    await loadProjects()
  }, [loadProjects])

  const setShowArchived = useCallback((nextShowArchived: boolean) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (nextShowArchived) params.set('archived', '1')
    else params.delete('archived')
    router.replace(`/app/projects${params.size > 0 ? `?${params.toString()}` : ''}`)
  }, [router, searchParams])

  if (view === 'chat' && id) {
    return (
      <ChatSuspenseBoundary
        userId={userId}
        firstName={firstName}
        hideSidebar
        projectName={projectName}
        contextNavigation={projectId ? (
          <ProjectHubModeControl activeTab="chat" onTabChange={navigateProjectMode} />
        ) : undefined}
      />
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
      showArchived={showArchived}
      onCreateProject={() => void createProject()}
      onRestoreProject={(restoreProjectId) => void restoreProject(restoreProjectId)}
      onShowArchivedChange={setShowArchived}
    />
  )
}
