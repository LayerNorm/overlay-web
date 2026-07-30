'use client'

import { useEffect, useState } from 'react'
import { Bot, FileText, FolderOpen, Library, Loader2, TriangleAlert, User, Workflow, X } from 'lucide-react'
import { usePresence } from '@overlay/ui'
import type {
  WorkspaceShareAccessRole,
  WorkspaceShareImpact,
  WorkspaceShareResourceType,
} from '@overlay/workspace-contracts'
import { shareRoleOptions, SHARE_RESOURCE_LABELS } from '@/shared/share/share-access-policy'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

export type AttachableResource = {
  resourceType: WorkspaceShareResourceType
  resourceId: string
  title: string
}

/**
 * Attach-time room grant prompt. Attaching a restricted resource to a room is
 * the moment access is decided, so this discloses who would gain access before
 * anything is posted, and posts a request-access link when the person declines.
 */
export function AttachResourceDialog({
  isOpen,
  conversationId,
  conversationTitle,
  onClose,
  onPost,
  workspaceId: activeWorkspaceId = null,
}: {
  isOpen: boolean
  conversationId: string
  conversationTitle: string
  onClose(): void
  onPost(message: string): Promise<void> | void
  /** Active workspace. Passed in so shared UI stays free of feature context. */
  workspaceId?: string | null
}) {
  const [resources, setResources] = useState<AttachableResource[]>([])
  const [selected, setSelected] = useState('')
  const [role, setRole] = useState<WorkspaceShareAccessRole>('viewer')
  const [impact, setImpact] = useState<WorkspaceShareImpact | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const { mounted, visible } = usePresence(isOpen)

  useEffect(() => {
    if (!isOpen || !activeWorkspaceId) return
    let current = true
    setLoading(true)
    void loadAttachableResources(activeWorkspaceId).then((items) => {
      if (!current) return
      setResources(items)
      setLoading(false)
    }).catch((error) => {
      if (!current) return
      setNotice(error instanceof Error ? error.message : 'Could not load your resources')
      setLoading(false)
    })
    return () => { current = false }
  }, [activeWorkspaceId, isOpen])

  useEffect(() => {
    if (!isOpen) {
      setImpact(null)
      setSelected('')
      setNotice(null)
    }
  }, [isOpen])

  if (!mounted) return null

  const resource = resources.find((item) => key(item) === selected)

  async function checkAccess() {
    if (!activeWorkspaceId || !resource) return
    setBusy(true)
    setNotice(null)
    try {
      const { impact: result } = await overlayAppClient.sharing.impact({
        workspaceId: activeWorkspaceId,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
      }, { targetType: 'room', targetId: conversationId })
      setImpact(result)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not check room access')
    } finally {
      setBusy(false)
    }
  }

  async function shareAndPost() {
    if (!activeWorkspaceId || !resource) return
    setBusy(true)
    try {
      await overlayAppClient.sharing.grant({
        workspaceId: activeWorkspaceId,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
      }, {
        targetType: 'room',
        targetId: conversationId,
        accessRole: role,
        confirmRoomExpansion: true,
      })
      await onPost(`Shared ${SHARE_RESOURCE_LABELS[resource.resourceType]} **${resource.title}** with this room.`)
      onClose()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not share with this room')
    } finally {
      setBusy(false)
    }
  }

  async function postWithoutAccess() {
    if (!resource) return
    setBusy(true)
    try {
      await onPost(
        `Mentioned ${SHARE_RESOURCE_LABELS[resource.resourceType]} **${resource.title}**`
        + ' — access was not shared, so anyone who needs it has to request access.',
      )
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[10080] flex items-center justify-center bg-black/55 p-4 transition-opacity duration-150 ${visible ? 'opacity-100' : 'opacity-0'}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attach-resource-title"
        className="w-[min(560px,94vw)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
          <div className="min-w-0">
            <h2 id="attach-resource-title" className="truncate text-lg font-semibold text-[var(--foreground)]">
              Attach a resource
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Posting into {conversationTitle} does not grant access on its own.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-subtle)]">
            <X size={17} />
          </button>
        </header>

        <div className="max-h-[min(560px,70vh)] overflow-y-auto px-6 py-5">
          {loading ? (
            <div data-testid="attach-resource-loading" className="flex h-20 items-center justify-center text-[var(--muted)]">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : resources.length === 0 ? (
            <p data-testid="attach-resource-empty" className="text-sm text-[var(--muted)]">
              You do not manage any files, projects, knowledge bases, automations, or agents yet.
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px]">
                <select
                  value={selected}
                  aria-label="Resource"
                  onChange={(event) => { setSelected(event.target.value); setImpact(null) }}
                  className="h-10 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]"
                >
                  <option value="">Choose a resource…</option>
                  {resources.map((item) => (
                    <option key={key(item)} value={key(item)}>
                      {item.title} · {SHARE_RESOURCE_LABELS[item.resourceType]}
                    </option>
                  ))}
                </select>
                <select
                  value={role}
                  aria-label="Permission"
                  onChange={(event) => setRole(event.target.value as WorkspaceShareAccessRole)}
                  className="h-10 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)]"
                >
                  {shareRoleOptions(resource?.resourceType ?? 'file').map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              {resource && !impact ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void checkAccess()}
                  className="mt-4 h-10 rounded-lg bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)] disabled:opacity-40"
                >
                  Check who can open it
                </button>
              ) : null}

              {impact ? (
                <section
                  data-testid="attach-resource-impact"
                  className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                    <TriangleAlert size={15} className="text-amber-500" />
                    {impact.gaining.length === 0
                      ? 'Everyone in this room can already open it'
                      : `${impact.gaining.length} ${impact.gaining.length === 1 ? 'participant' : 'participants'} cannot open it yet`}
                  </div>
                  {impact.gaining.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {impact.gaining.map((principal) => (
                        <li key={principal.principalId} className="flex items-center gap-2 text-xs text-[var(--foreground)]">
                          {principal.kind === 'agent' ? <Bot size={12} /> : <User size={12} />}
                          <span className="truncate">{principal.name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="mt-3 text-[11px] text-[var(--muted)]">
                    Sharing with the room follows its membership: people and agents added later
                    inherit the same access until the grant is removed.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void shareAndPost()}
                      className="h-9 rounded-lg bg-[var(--foreground)] px-3 text-xs font-medium text-[var(--background)] disabled:opacity-40"
                    >
                      Share with this room and post
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void postWithoutAccess()}
                      className="h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--surface-subtle)] disabled:opacity-40"
                    >
                      Post link only
                    </button>
                  </div>
                </section>
              ) : null}
            </>
          )}

          {notice ? <p data-testid="attach-resource-notice" className="mt-4 text-xs text-[var(--muted)]">{notice}</p> : null}
        </div>
      </div>
    </div>
  )
}

export function attachableResourceIcon(resourceType: WorkspaceShareResourceType) {
  if (resourceType === 'project') return <FolderOpen size={13} />
  if (resourceType === 'knowledge_base') return <Library size={13} />
  if (resourceType === 'automation') return <Workflow size={13} />
  if (resourceType === 'agent') return <Bot size={13} />
  return <FileText size={13} />
}

function key(resource: AttachableResource) {
  return `${resource.resourceType}:${resource.resourceId}`
}

/**
 * Only resources the person can actually manage are offered; the server still
 * re-checks ownership before creating any grant.
 */
async function loadAttachableResources(workspaceId: string): Promise<AttachableResource[]> {
  const [files, projects, knowledgeBases, automations, agents] = await Promise.allSettled([
    overlayAppClient.files.get<Array<{ _id: string; name?: string; title?: string }>>({ limit: 50, summary: true }),
    overlayAppClient.projects.get<Array<{ _id?: string; id?: string; name: string }>>({ limit: 50 }),
    overlayAppClient.knowledgeBases.list(),
    overlayAppClient.automations.get<Array<{ _id?: string; id?: string; name: string }>>({ limit: 50 }),
    overlayAppClient.agents.list(workspaceId),
  ])
  const resources: AttachableResource[] = []
  if (files.status === 'fulfilled' && Array.isArray(files.value)) {
    for (const file of files.value) {
      resources.push({
        resourceType: 'file',
        resourceId: file._id,
        title: file.name ?? file.title ?? 'Untitled file',
      })
    }
  }
  if (projects.status === 'fulfilled' && Array.isArray(projects.value)) {
    for (const project of projects.value) {
      const id = project._id ?? project.id
      if (id) resources.push({ resourceType: 'project', resourceId: id, title: project.name })
    }
  }
  if (knowledgeBases.status === 'fulfilled') {
    for (const base of knowledgeBases.value.knowledgeBases) {
      resources.push({ resourceType: 'knowledge_base', resourceId: base.id, title: base.title })
    }
  }
  if (automations.status === 'fulfilled' && Array.isArray(automations.value)) {
    for (const automation of automations.value) {
      const id = automation._id ?? automation.id
      if (id) resources.push({ resourceType: 'automation', resourceId: id, title: automation.name })
    }
  }
  if (agents.status === 'fulfilled') {
    for (const agent of agents.value.agents) {
      resources.push({ resourceType: 'agent', resourceId: agent.id, title: agent.name })
    }
  }
  return resources
}
