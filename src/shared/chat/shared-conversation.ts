export type SharedMessagePart =
  | { type: 'tool-invocation'; toolInvocation: { toolName: string; state?: string } }
  | { type: 'data'; id: string; dataType: 'overlay.generated_ui'; data: unknown; transient?: boolean }
  | { type: string; text?: string; url?: string; mediaType?: string; fileName?: string }

export type SharedConversation = {
  _id: string
  title: string
  createdAt: number
  sharedAt: number
  messages: Array<{
    _id: string
    role: 'user' | 'assistant'
    mode: 'ask' | 'act'
    content: string
    contentType: 'text' | 'image' | 'video'
    parts: SharedMessagePart[] | null
    modelId: string | null
    variantIndex?: number
    turnId: string
    createdAt: number
  }>
}
