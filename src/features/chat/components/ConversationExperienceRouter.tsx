'use client'

import { useSearchParams } from 'next/navigation'
import ChatExperience from './ChatExperience'
import { DirectMessageExperience } from './DirectMessageExperience'
import type { ComponentProps } from 'react'

export function ConversationExperienceRouter(props: ComponentProps<typeof ChatExperience>) {
  const searchParams = useSearchParams()
  const conversationId = searchParams?.get('id')
  if (searchParams?.get('view') === 'dms' && conversationId) {
    return (
      <DirectMessageExperience
        conversationId={conversationId}
        showcase={Boolean(props.publicShowcaseSnapshots)}
      />
    )
  }
  if (searchParams?.get('view') === 'channels' && conversationId) {
    return (
      <DirectMessageExperience
        conversationId={conversationId}
        conversationType="channel"
        showcase={Boolean(props.publicShowcaseSnapshots)}
      />
    )
  }
  return <ChatExperience {...props} />
}
