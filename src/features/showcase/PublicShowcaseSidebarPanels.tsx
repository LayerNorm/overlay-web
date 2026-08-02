'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { File, Folder, Workflow } from 'lucide-react'
import { SidebarResourceList } from '@overlay/ui/primitives'
import {
  SHOWCASE_AUTOMATIONS,
  SHOWCASE_KNOWLEDGE_NODES,
  SHOWCASE_PROJECTS,
} from './showcase-data'

const rowClass =
  'flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

export function PublicShowcaseFilesInlinePanel({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeId = searchParams?.get('file') ?? null

  return (
    <SidebarResourceList>
      {SHOWCASE_KNOWLEDGE_NODES.map((file) => (
        <button
          key={file._id}
          type="button"
          className={`${rowClass} ${activeId === file._id ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
          onClick={() => {
            router.push(`/app/files?${new URLSearchParams({ showcase: '1', file: file._id }).toString()}`)
            onNavigate?.()
          }}
        >
          <File size={12} className="shrink-0" />
          <span className="truncate">{file.name}</span>
        </button>
      ))}
    </SidebarResourceList>
  )
}

export function PublicShowcaseProjectsInlinePanel({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeId = searchParams?.get('projectId') ?? `showcase-${SHOWCASE_PROJECTS[0]!.id}`

  return (
    <SidebarResourceList>
      {SHOWCASE_PROJECTS.map((project) => {
        const id = `showcase-${project.id}`
        return (
          <button
            key={id}
            type="button"
            className={`${rowClass} ${activeId === id ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
            onClick={() => {
              router.push(`/app/projects?${new URLSearchParams({ showcase: '1', projectId: id }).toString()}`)
              onNavigate?.()
            }}
          >
            <Folder size={12} className="shrink-0" />
            <span className="truncate">{project.name}</span>
          </button>
        )
      })}
    </SidebarResourceList>
  )
}

export function PublicShowcaseAutomationsInlinePanel({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeId = searchParams?.get('automationId') ?? `showcase-${SHOWCASE_AUTOMATIONS[0]!.id}`

  return (
    <SidebarResourceList>
      {SHOWCASE_AUTOMATIONS.map((automation) => {
        const id = `showcase-${automation.id}`
        return (
          <button
            key={id}
            type="button"
            className={`${rowClass} ${activeId === id ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
            onClick={() => {
              router.push(`/app/automations?${new URLSearchParams({ showcase: '1', automationId: id }).toString()}`)
              onNavigate?.()
            }}
          >
            <Workflow size={12} className="shrink-0" />
            <span className="truncate">{automation.name}</span>
          </button>
        )
      })}
    </SidebarResourceList>
  )
}
