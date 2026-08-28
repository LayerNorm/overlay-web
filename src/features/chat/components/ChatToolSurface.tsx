'use client'

import { ChatExchange } from '@overlay/chat-react/transcript'
import type { ChatTranscriptSourceView } from '@overlay/chat-core'
import type { ComponentProps } from 'react'

type ChatToolSurfaceProps = ComponentProps<typeof ChatExchange> & {
  responseSources?: readonly ChatTranscriptSourceView[]
}

export function ChatToolSurface(props: ChatToolSurfaceProps) {
  return <ChatExchange {...props} />
}
