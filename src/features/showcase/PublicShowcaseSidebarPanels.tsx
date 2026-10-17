'use client'
import { unstyledButton } from '@overlay/ui/control-reset'

import { useRouter, useSearchParams } from 'next/navigation'
import { File, Workflow } from 'lucide-react'
import { SidebarResourceList, Button } from '@overlay/ui/primitives'
import {
  SHOWCASE_AUTOMATIONS,
  SHOWCASE_KNOWLEDGE_NODES,
} from './showcase-data'

const rowClass =
  'flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)'

export function PublicShowcaseFilesInlinePanel({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeId = searchParams?.get('file') ?? null

  return (
    <SidebarResourceList>
      {SHOWCASE_KNOWLEDGE_NODES.map((file) => (
        <Button variant="ghost"
          key={file._id}
          type="button"
          className={unstyledButton(`${rowClass} ${activeId === file._id ? 'bg-(--surface-subtle)' : ''}`)}
          onClick={() => {
            router.push(`/app/files?${new URLSearchParams({ showcase: '1', file: file._id }).toString()}`)
            onNavigate?.()
          }}
        >
          <File size={12} className="shrink-0" />
          <span className="truncate">{file.name}</span>
        </Button>
      ))}
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
          <Button variant="ghost"
            key={id}
            type="button"
            className={unstyledButton(`${rowClass} ${activeId === id ? 'bg-(--surface-subtle)' : ''}`)}
            onClick={() => {
              router.push(`/app/automations?${new URLSearchParams({ showcase: '1', automationId: id }).toString()}`)
              onNavigate?.()
            }}
          >
            <Workflow size={12} className="shrink-0" />
            <span className="truncate">{automation.name}</span>
          </Button>
        )
      })}
    </SidebarResourceList>
  )
}
