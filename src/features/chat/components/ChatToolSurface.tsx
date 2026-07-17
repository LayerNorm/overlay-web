'use client'

import { ChatExchange } from '@overlay/chat-react/transcript'
import type { ComponentProps } from 'react'

type ChatToolSurfaceProps = ComponentProps<typeof ChatExchange>

export function ChatToolSurface(props: ChatToolSurfaceProps) {
  return <ChatExchange {...props} />
}
