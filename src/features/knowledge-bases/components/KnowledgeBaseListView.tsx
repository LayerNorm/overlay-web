'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpen, Brain, Loader2, Plus, Users } from 'lucide-react'
import type { KnowledgeBase } from '@overlay/app-core'
import { Button, DialogFrame, HeaderSearch, Tile, TileGrid, TileIcon } from '@overlay/ui'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useVisibleReconciliation } from '@/components/useVisibleReconciliation'
import { NEW_KNOWLEDGE_BASE_EVENT } from '@/shared/workspace/sidebar-events'
import { useWorkspace } from '@/features/workspaces/components/WorkspaceProvider'
import { useWorkspaceChanged } from '@/features/workspaces/lib/use-workspace-changed'

export function KnowledgeBaseListView({
  initialKnowledgeBases,
  userId,
}: {
  initialKnowledgeBases: KnowledgeBase[]
  userId: string
}) {
  const router = useRouter()
  const { activeWorkspace } = useWorkspace()
  const [knowledgeBases, setKnowledgeBases] = useState(initialKnowledgeBases)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [openingPersonal, setOpeningPersonal] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const openCreateDialog = () => setCreateOpen(true)
    window.addEventListener(NEW_KNOWLEDGE_BASE_EVENT, openCreateDialog)
    return () => window.removeEventListener(NEW_KNOWLEDGE_BASE_EVENT, openCreateDialog)
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return knowledgeBases
    return knowledgeBases.filter((base) => (
      `${base.title} ${base.description ?? ''}`.toLowerCase().includes(needle)
    ))
  }, [knowledgeBases, query])
  const personalBrain = knowledgeBases.find((base) => (
    base.kind === 'personal' && base.title === 'My knowledge'
  ))
  const regularFiltered = filtered.filter((base) => base.id !== personalBrain?.id)
  const showPersonalBrain = activeWorkspace?.kind === 'personal' && (
    !query.trim() || 'my knowledge personal brain'.includes(query.trim().toLowerCase())
  )

  const reconcileKnowledgeBases = useCallback(async () => {
    const response = await overlayAppClient.knowledgeBases.list()
    setKnowledgeBases(response.knowledgeBases)
  }, [])
  useVisibleReconciliation(reconcileKnowledgeBases)
  useWorkspaceChanged(useCallback(() => {
    setKnowledgeBases([])
    void reconcileKnowledgeBases()
  }, [reconcileKnowledgeBases]))

  async function openPersonalBrain() {
    if (openingPersonal) return
    if (personalBrain) {
      router.push(`/app/knowledge/${encodeURIComponent(personalBrain.id)}`)
      return
    }
    setOpeningPersonal(true)
    setError(null)
    try {
      const result = await overlayAppClient.knowledgeBases.ensurePersonal()
      setKnowledgeBases((current) => (
        current.some(({ id }) => id === result.knowledgeBase.id)
          ? current
          : [result.knowledgeBase, ...current]
      ))
      router.push(`/app/knowledge/${encodeURIComponent(result.knowledgeBase.id)}`)
    } catch (personalError) {
      setError(personalError instanceof Error ? personalError.message : 'Could not open My knowledge')
    } finally {
      setOpeningPersonal(false)
    }
  }

  async function createKnowledgeBase() {
    if (!title.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      const result = await overlayAppClient.knowledgeBases.create({
        title: title.trim(),
        description: description.trim() || undefined,
        kind: 'personal',
      })
      setKnowledgeBases((current) => [result.knowledgeBase, ...current])
      setCreateOpen(false)
      setTitle('')
      setDescription('')
      router.push(`/app/knowledge/${encodeURIComponent(result.knowledgeBase.id)}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create knowledge base')
    } finally {
      setCreating(false)
    }
  }

  return (
    <AppScreenShell
      header={(
        <AppScreenHeader
          title="Knowledge"
          actions={(
            <>
              <HeaderSearch
                value={query}
                onChange={setQuery}
                label="Search knowledge bases"
              />
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus size={14} />
                New
              </Button>
            </>
          )}
        />
      )}
    >
      <AppScreenBody padding="lg" maxWidth="xl" className="min-h-full">
        {showPersonalBrain || regularFiltered.length > 0 ? (
          <TileGrid columns={3} data-testid="knowledge-base-list">
            {showPersonalBrain ? (
              <Tile
                as="button"
                onClick={() => void openPersonalBrain()}
                disabled={openingPersonal}
                className="min-h-40"
                data-testid="personal-brain"
                leading={(
                  <TileIcon>
                    {openingPersonal ? <Loader2 className="animate-spin" size={17} /> : <Brain size={17} />}
                  </TileIcon>
                )}
                topRight={<span className="text-xs text-[var(--muted)]">Private</span>}
                title="My knowledge"
                description="Curate reusable facts, answers, and sources that belong to you."
              />
            ) : null}
            {regularFiltered.map((base) => {
              const owned = base.ownerUserId === userId
              return (
                <Tile
                  key={base.id}
                  as={Link}
                  href={`/app/knowledge/${encodeURIComponent(base.id)}`}
                  className="min-h-40"
                  data-testid={`knowledge-base-${base.id}`}
                  leading={<TileIcon><BookOpen size={17} /></TileIcon>}
                  topRight={(
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                      {!owned ? <Users size={12} /> : null}
                      {owned ? 'Yours' : 'Shared'}
                    </span>
                  )}
                  title={base.title}
                  description={base.description || 'Add sources and start asking questions.'}
                />
              )
            })}
          </TileGrid>
        ) : (
          <div className="flex min-h-[55vh] flex-col items-center justify-center px-4 text-center" data-testid="knowledge-base-empty">
            <BookOpen size={24} className="text-[var(--muted)]" />
            <h2 className="mt-4 text-base font-medium">
              {query ? 'No matching knowledge bases' : 'Create your first knowledge base'}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--muted)]">
              {query
                ? 'Try a different title or description.'
                : 'Drop in documents, let Overlay index them, then ask questions with source-backed answers.'}
            </p>
            {!query ? (
              <Button variant="primary" className="mt-5" onClick={() => setCreateOpen(true)}>
                <Plus size={15} />
                New
              </Button>
            ) : null}
          </div>
        )}
      </AppScreenBody>

      <DialogFrame
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create knowledge base"
        description="Start with a name. Sources can be added in the workspace."
        footer={(
          <>
            <Button onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button variant="primary" onClick={() => void createKnowledgeBase()} disabled={!title.trim() || creating}>
              {creating ? <Loader2 className="animate-spin" size={14} /> : null}
              Create
            </Button>
          </>
        )}
      >
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-medium">
            Name
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createKnowledgeBase()
              }}
              maxLength={160}
              placeholder="Organic Chemistry"
              className="mt-1.5 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--muted)]"
            />
          </label>
          <label className="block text-xs font-medium">
            Description <span className="font-normal text-[var(--muted)]">(optional)</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="What this knowledge base covers"
              className="mt-1.5 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--muted)]"
            />
          </label>
          {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
        </div>
      </DialogFrame>
    </AppScreenShell>
  )
}
