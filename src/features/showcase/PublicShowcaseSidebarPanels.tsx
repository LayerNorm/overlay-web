'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { File, Workflow } from 'lucide-react'
import { SidebarResourceList, SidebarMenuSubButton } from '@overlay/ui/primitives'
import {
  SHOWCASE_AUTOMATIONS,
  SHOWCASE_KNOWLEDGE_NODES,
} from './showcase-data'

export function PublicShowcaseFilesInlinePanel({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeId = searchParams?.get('file') ?? null

  return (
    <SidebarResourceList>
      {SHOWCASE_KNOWLEDGE_NODES.map((file) => (
        <SidebarMenuSubButton
          key={file._id}
          type="button"
          isActive={activeId === file._id}
          aria-current={activeId === file._id ? 'page' : undefined}
          onClick={() => {
            router.push(`/app/files?${new URLSearchParams({ showcase: '1', file: file._id }).toString()}`)
            onNavigate?.()
          }}
        >
          <File aria-hidden />
          <span className="truncate">{file.name}</span>
        </SidebarMenuSubButton>
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
          <SidebarMenuSubButton
            key={id}
            type="button"
            isActive={activeId === id}
            aria-current={activeId === id ? 'page' : undefined}
            onClick={() => {
              router.push(`/app/automations?${new URLSearchParams({ showcase: '1', automationId: id }).toString()}`)
              onNavigate?.()
            }}
          >
            <Workflow aria-hidden />
            <span className="truncate">{automation.name}</span>
          </SidebarMenuSubButton>
        )
      })}
    </SidebarResourceList>
  )
}
