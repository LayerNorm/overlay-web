'use client'

import { BookOpen, Plus } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { Button } from '@overlay/ui/primitives'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { useGuestGate } from '@/components/providers/GuestGateProvider'
import { NEW_KNOWLEDGE_BASE_EVENT } from '@/shared/workspace/sidebar-events'

const SHOWCASE_KNOWLEDGE_BASES = [
  {
    id: 'showcase-product',
    title: 'Product knowledge',
    description: 'Product principles, capabilities, and customer-facing context.',
  },
  {
    id: 'showcase-launch',
    title: 'Launch research',
    description: 'Research notes, evidence, and decisions behind this showcase.',
  },
] as const

export function PublicShowcaseKnowledgeBasesView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { requireAuth } = useGuestGate()
  const activeId = searchParams?.get('knowledgeBase') ?? SHOWCASE_KNOWLEDGE_BASES[0]!.id

  useEffect(() => {
    const openCreateDialog = () => requireAuth('nav')
    window.addEventListener(NEW_KNOWLEDGE_BASE_EVENT, openCreateDialog)
    return () => window.removeEventListener(NEW_KNOWLEDGE_BASE_EVENT, openCreateDialog)
  }, [requireAuth])

  return (
    <AppScreenShell
      header={(
        <AppScreenHeader
          title="Knowledge"
          actions={(
            <Button variant="secondary" onClick={() => requireAuth('nav')}>
              <Plus size={14} /> New Knowledge Base
            </Button>
          )}
        />
      )}
    >
      <AppScreenBody padding="lg" maxWidth="xl" className="min-h-full">
        <div className="grid gap-4 sm:grid-cols-2">
          {SHOWCASE_KNOWLEDGE_BASES.map((knowledgeBase) => (
            <button
              key={knowledgeBase.id}
              type="button"
              onClick={() => router.push(`/app/knowledge?${new URLSearchParams({ showcase: '1', knowledgeBase: knowledgeBase.id }).toString()}`)}
              className={`min-h-40 rounded-xl border p-5 text-left transition-colors ${activeId === knowledgeBase.id ? 'border-[var(--foreground)] bg-[var(--surface-subtle)]' : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)]'}`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--surface-subtle)] text-[var(--muted)]">
                <BookOpen size={17} />
              </span>
              <h2 className="mt-5 text-sm font-medium">{knowledgeBase.title}</h2>
              <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{knowledgeBase.description}</p>
            </button>
          ))}
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}
