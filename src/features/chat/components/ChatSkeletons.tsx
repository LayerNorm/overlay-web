'use client'

import { AtSign, Bell, Inbox, MessageCircle, Smile } from 'lucide-react'
import type { WorkspaceNotificationFilter } from '@overlay/workspace-contracts'
import { AppScreenShell } from '@overlay/modules-react/shell'
import { SegmentedControl } from '@overlay/ui/primitives'
import { RouteSkeletonHeader, SkeletonBlock } from '@/app/app/_components/AppRouteSkeletons'
import { ChatMessageListPlaceholder } from './ChatMessageListSkeleton'

/** ChatExperienceHeader's padding, so the title starts where the loaded one does. */
const CHAT_HEADER_CLASS = 'md:px-4'

/** The chat composer card (ChatComposer + PromptInput geometry) with the disclaimer line the chat mode shows. */
function ComposerSkeleton({ disclaimer }: { disclaimer: boolean }) {
  return (
    <div className="shrink-0 px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="mx-auto w-full min-w-0 max-w-4xl">
        <div className="rounded-2xl border border-(--border) bg-(--surface-elevated) p-2.5 sm:p-3">
          <div className="min-h-11 px-0.5 py-1">
            <div className="flex h-6 items-center"><SkeletonBlock className="h-3 w-40" /></div>
          </div>
          <div className="mt-2 flex min-h-9 items-center gap-1.5">
            <div className="flex size-9 items-center justify-center"><SkeletonBlock className="size-4" /></div>
            <div className="flex size-9 items-center justify-center"><SkeletonBlock className="size-4" /></div>
            <div className="flex-1" />
            <SkeletonBlock className="mx-2.5 h-3 w-20" />
            <div className="ui-skeleton-line size-9 shrink-0 rounded-lg" />
          </div>
        </div>
        {disclaimer ? (
          <p className="mt-2 text-center text-[11px] text-(--muted-light)">Overlay can make mistakes. Check important info.</p>
        ) : null}
      </div>
    </div>
  )
}

/** Every chat stage (route, Suspense, auth gate): the real header, an empty transcript area and the composer. */
export function ChatRouteSkeleton({ mode = 'chat', hideHeader = false }: { mode?: 'chat' | 'automate'; hideHeader?: boolean }) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-(--background)" role="status" aria-label="Loading chat">
      {hideHeader ? null : (
        <RouteSkeletonHeader title={mode === 'automate' ? 'Automations' : undefined} className={CHAT_HEADER_CLASS} />
      )}
      <div className="min-h-0 flex-1" />
      <ComposerSkeleton disclaimer={mode === 'chat'} />
    </div>
  )
}

function ReceivedRowSkeleton({ lines }: { lines: string[] }) {
  return (
    <div className="flex gap-2.5 py-1">
      <div className="ui-skeleton-line size-9 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex h-5 items-center gap-2">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-2.5 w-10" />
        </div>
        {lines.map((width) => (
          <div key={width} className="flex h-6 items-center"><SkeletonBlock className={`h-3 ${width}`} /></div>
        ))}
      </div>
    </div>
  )
}

/** Room transcript rows shaped like RoomMessageItem: others with a 36px avatar, your own as a right-aligned bubble. */
export function RoomMessageRowsSkeleton() {
  return (
    <>
      <ReceivedRowSkeleton lines={['w-[72%]', 'w-[44%]']} />
      <div className="flex justify-end py-1">
        <div className="ui-skeleton-line h-10 w-[min(60%,18rem)] rounded-[18px]" />
      </div>
      <ReceivedRowSkeleton lines={['w-[84%]', 'w-[66%]', 'w-[32%]']} />
    </>
  )
}

/** DM, channel and agent thread routes: header, bottom-anchored transcript rows and the composer. */
export function ConversationRouteSkeleton({ label = 'Loading conversation' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-(--background)" role="status" aria-label={label}>
      <RouteSkeletonHeader />
      <div className="min-h-0 flex-1 overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
        <div className="mx-auto flex h-full w-full min-w-0 max-w-4xl flex-col justify-end gap-1 sm:gap-1.5" aria-hidden>
          <RoomMessageRowsSkeleton />
        </div>
      </div>
      <ComposerSkeleton disclaimer />
    </div>
  )
}

export const ACTIVITY_FILTERS: Array<{ value: WorkspaceNotificationFilter; label: string; icon: typeof Bell }> = [
  { value: 'all', label: 'All', icon: Inbox },
  { value: 'unread', label: 'Unread', icon: Bell },
  { value: 'mentions', label: 'Mentions', icon: AtSign },
  { value: 'threads', label: 'Threads', icon: MessageCircle },
  { value: 'reactions', label: 'Reactions', icon: Smile },
]

/** Notification rows in ChatActivityView's list column: 28px round icon, title, body and time. */
export function ActivityRowsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6" role="status" aria-label="Loading activity">
      <ul className="space-y-0.5" aria-hidden>
        {['w-[46%]', 'w-[58%]', 'w-[38%]', 'w-[52%]', 'w-[44%]', 'w-[60%]'].map((width) => (
          <li key={width} className="flex gap-3 px-3 py-3">
            <div className="ui-skeleton-line mt-0.5 size-7 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="flex h-5 items-center"><SkeletonBlock className={`h-3 ${width}`} /></div>
              <div className="mt-0.5 flex h-5 items-center"><SkeletonBlock className="h-2.5 w-[78%]" /></div>
              <div className="mt-1 flex h-4 items-center"><SkeletonBlock className="h-2 w-24" /></div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Activity: the real header with its filter, and notification rows. */
export function ActivityRouteSkeleton() {
  return (
    <AppScreenShell
      className="h-full"
      header={(
        <RouteSkeletonHeader
          title="Activity"
          actions={(
            <SegmentedControl value="all" options={ACTIVITY_FILTERS} onChange={() => {}} ariaLabel="Activity filters" disabled />
          )}
        />
      )}
    >
      <ActivityRowsSkeleton />
    </AppScreenShell>
  )
}

/** Archived chats: the chat transcript with the archived notice where the composer would be. */
export function ArchivedRouteSkeleton() {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-(--background)" role="status" aria-label="Loading archived chat">
      <RouteSkeletonHeader className={CHAT_HEADER_CLASS} />
      <ChatMessageListPlaceholder />
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 px-4 py-4">
        <p className="text-center text-xs text-(--muted)">This chat is archived.</p>
        <SkeletonBlock className="h-8 w-[72px]" />
      </div>
    </div>
  )
}
