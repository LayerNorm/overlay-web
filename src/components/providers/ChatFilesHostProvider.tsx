'use client'

import { useMemo, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChatFilesProvider, type ChatFilesHost } from '@overlay/chat-react'
import { useFileSummaries } from '@/hooks/use-file-tree'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'

/**
 * File cards and tool rows in every chat surface read file metadata from Convex and open files on the Files page.
 * Agent threads nest their own provider that opens files in the Library panel instead.
 */
export function ChatFilesHostProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const buildWorkspaceHref = useWorkspaceHref()
  const host = useMemo<ChatFilesHost>(() => ({
    useFileSummaries,
    openFile: ({ id }) => router.push(buildWorkspaceHref(null, `/app/files?file=${encodeURIComponent(id)}`)),
  }), [buildWorkspaceHref, router])
  return <ChatFilesProvider value={host}>{children}</ChatFilesProvider>
}
