'use client'

import { useConvexAuth, useQuery } from 'convex/react'
import { SlackMark } from '@/components/brand/AppMarks'
import { isPrivateThreadId } from '@/shared/agents/private-threads'
import { api } from '../../../../convex/_generated/api'

type SlackThreadOriginValue = { kind: 'channel' | 'dm'; channelName: string | null; openUrl: string }

/** Where a thread that started in Slack came from, for its header (internal/develop/slack-integration.md). */
export function useSlackThreadOrigin(conversationId: string | null | undefined): SlackThreadOriginValue | null {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const ready = Boolean(conversationId && !isPrivateThreadId(conversationId) && isAuthenticated && !isLoading)
  return useQuery(api.integrations.slack.threadOrigin, ready ? { conversationId: conversationId! } : 'skip') ?? null
}

export function SlackThreadOriginLabel({ origin }: { origin: SlackThreadOriginValue }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <SlackMark size={11} />
      {origin.kind === 'dm' ? 'Your Slack DM' : origin.channelName ? '#' + origin.channelName.replace(/^#/, '') : 'Slack'}
      <span aria-hidden>·</span>
      <a href={origin.openUrl} target="_blank" rel="noreferrer" className="hover:text-(--foreground) hover:underline">Open in Slack</a>
    </span>
  )
}
