'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useConvexAuth, useQuery } from 'convex/react'
import { Archive, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState } from '@overlay/ui/primitives'
import { AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
import { usePersonalChatDirectory } from '@/components/providers/PersonalChatProvider'
import { useOptionalWorkspace } from '@/contexts/WorkspaceContext'
import { useWorkspaceHref } from '@/hooks/use-workspace-href'
import { ARCHIVED_SETTINGS_PATH } from '@/shared/workspaces/panel-scope'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { isConvexIdShape } from '@/components/providers/usePersonalChatTranscript'

const ChatExperience = dynamic(() => import('./ChatExperience'))
const DirectMessageExperience = dynamic(
  () => import('./DirectMessageExperience').then((module) => ({ default: module.DirectMessageExperience })),
)

type ArchivedConversation = {
  _id: string
  title?: string | null
  conversationType?: string
  archivedAt?: number
}

function readSelectedId(searchId: string | null): string | null {
  if (typeof window === 'undefined') return searchId
  return new URLSearchParams(window.location.search).get('id') ?? searchId
}

/** Archived personal chats (live chat list) and channels and DMs (live archived-rooms query), newest first. */
function useArchivedConversations(userId: string | null, selectedId: string | null) {
  const nativePersonal = usePersonalChatDirectory()
  const workspaceId = useOptionalWorkspace()?.activeWorkspaceId ?? null
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const canQueryRooms = Boolean(workspaceId && userId && isAuthenticated && !authLoading)
  const include = selectedId && isConvexIdShape(selectedId) ? selectedId as Id<'conversations'> : undefined
  const rooms = useQuery(api.collaboration.archive.rooms,
    canQueryRooms ? { workspaceId: workspaceId!, ...(include ? { include } : {}) } : 'skip')
  const { archived, selectedSummary } = nativePersonal

  const conversations = useMemo(() => {
    if (!workspaceId || nativePersonal.workspaceId !== workspaceId) return []
    const rows: ArchivedConversation[] = [...(rooms ?? []), ...archived.rows]
    if (selectedSummary?.archivedAt && selectedSummary.workspaceId === workspaceId) rows.push(selectedSummary)
    const byId = new Map<string, ArchivedConversation>()
    for (const row of rows) byId.set(row._id, row)
    return [...byId.values()].sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0))
  }, [archived.rows, nativePersonal.workspaceId, rooms, selectedSummary, workspaceId])

  const waitingForSelected = Boolean(selectedId && (
    nativePersonal.selectedConversationId !== selectedId || selectedSummary === undefined
  ))
  const selectedUnavailable = waitingForSelected && archived.status === 'unavailable'
  // Signed out of Convex once auth settles means the rooms cannot load: show unavailable, not a spinner forever.
  const roomsUnavailable = rooms === null || Boolean(userId && !authLoading && !isAuthenticated)
  const loading = Boolean(userId && (authLoading || (canQueryRooms && rooms === undefined)))
    || (waitingForSelected && !selectedUnavailable)
    || archived.status === 'loading'
  return {
    conversations,
    loading,
    selectedUnavailable,
    unavailable: roomsUnavailable || archived.status === 'unavailable',
  }
}

function ArchivedNotice({ children }: { children: ReactNode }) {
  return (
    <AppScreenShell className="h-full" header={<AppScreenHeader title="Archived" />}>
      {children}
    </AppScreenShell>
  )
}

function ArchivedSpinner({ label }: { label: string }) {
  return (
    <ArchivedNotice>
      <div className="flex h-full min-h-72 items-center justify-center text-sm text-(--muted)">
        <Loader2 size={16} className="mr-2 animate-spin" />
        {label}
      </div>
    </ArchivedNotice>
  )
}

/** Replaces the composer of an archived personal chat: it is read-only until restored. */
function ArchivedChatFooter({ conversationId }: { conversationId: string }) {
  const nativePersonal = usePersonalChatDirectory()
  const workspaceId = useOptionalWorkspace()?.activeWorkspaceId ?? null
  const buildWorkspaceHref = useWorkspaceHref()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const summary = nativePersonal.archived.rows.find((row) => row._id === conversationId)
    ?? (nativePersonal.selectedSummary?._id === conversationId ? nativePersonal.selectedSummary : null)

  const restore = async () => {
    if (!summary || busy) return
    setBusy(true)
    try {
      await nativePersonal.setArchived(summary, false)
      const scope = summary.scope === 'workspace' ? 'workspace' : 'personal'
      const href = `/app/chat?${new URLSearchParams({ id: conversationId, scope }).toString()}`
      router.push(workspaceId ? buildWorkspaceHref(workspaceId, href, scope) : href)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not restore this chat.')
      setBusy(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 px-4 py-4">
      <p role="status" className="text-center text-xs text-(--muted)">This chat is archived.</p>
      {summary ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void restore() }}>
          {busy ? 'Restoring…' : 'Restore'}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Archived chats open as the conversation itself. Settings → Archived is the index; this page shows the selected
 * archived chat named by `?id=`; an id that is not archived in this workspace says so instead of opening another chat. Personal AI chats come from the live chat list and channels and DMs from
 * the live archived-rooms query, so an archive or restore anywhere shows at once.
 */
export function ChatArchivedView({
  userId,
  firstName,
}: {
  userId: string | null
  firstName?: string
}) {
  const searchParams = useSearchParams()
  const selectedId = readSelectedId(searchParams?.get('id') ?? null)
  const { conversations, loading, selectedUnavailable, unavailable } =
    useArchivedConversations(userId, selectedId)

  if (loading) return <ArchivedSpinner label="Loading archived chat…" />
  const selected = conversations.find((conversation) => conversation._id === selectedId)
  if (selectedUnavailable && !selected) {
    return (
      <ArchivedNotice>
        <EmptyState
          className="h-full min-h-72 px-6 py-12"
          icon={<Archive size={28} />}
          title="Archived chats are unavailable"
          description="The selected conversation could not be checked."
        />
      </ArchivedNotice>
    )
  }
  if (!selected) {
    return (
      <ArchivedNotice>
        <EmptyState
          className="h-full min-h-72 px-6 py-12"
          icon={<Archive size={28} />}
          title={unavailable ? 'Archived chats are unavailable' : 'Archived chat not found'}
          description={unavailable
            ? 'Archived conversations could not be loaded.'
            : 'It may have been restored or deleted, or it belongs to another workspace.'}
          action={(
            <Button size="sm" variant="outline" asChild>
              <Link href={ARCHIVED_SETTINGS_PATH}>Open Archived</Link>
            </Button>
          )}
        />
      </ArchivedNotice>
    )
  }
  if (selected.conversationType === 'channel' || selected.conversationType === 'dm') {
    return (
      <DirectMessageExperience
        key={`archived-${selected.conversationType}:${selected._id}`}
        conversationId={selected._id}
        {...(selected.conversationType === 'channel' ? { conversationType: 'channel' as const } : {})}
      />
    )
  }
  return (
    <ChatExperience
      userId={userId}
      firstName={firstName}
      hideSidebar
      readOnlyFooter={<ArchivedChatFooter conversationId={selected._id} />}
    />
  )
}
