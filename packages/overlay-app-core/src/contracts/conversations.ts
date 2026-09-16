export interface ConversationSummary {
  _id: string
  title: string
  lastModified: number
  createdAt: number
  updatedAt: number
  deletedAt?: number
  lastMode: 'ask' | 'act'
  askModelIds: string[]
  actModelId: string
  clientId?: string
  projectId?: string
}

export type ConversationMessagePart =
  | { type: 'text'; text?: string }
  | { type: 'file'; url?: string; mediaType?: string; fileName?: string }
  | {
      type: 'data'
      id: string
      dataType: 'overlay.generated_ui'
      data:
        | {
            version: 1
            kind: 'draft.text'
            title?: string
            body: string
            format?: 'plain' | 'markdown'
          }
        | {
            version: 1
            kind: 'draft.email'
            subject: string
            body: string
            to?: string[]
            cc?: string[]
            bcc?: string[]
            provider?: 'gmail'
            variants?: Array<{ id: string; label: string; subject?: string; body: string }>
          }
        | {
            version: 1
            kind: 'connector.connect'
            serviceName: string
            slug?: string
            description?: string
            connectUrl?: string
            connected?: boolean
          }
      transient?: boolean
    }
  | {
      type: 'tool-invocation'
      toolInvocation: {
        toolCallId?: string
        toolName: string
        state?: string
        toolInput?: Record<string, unknown>
        toolOutput?: unknown
      }
    }

export interface ConversationMessage {
  id: string
  turnId: string
  mode: 'ask' | 'act'
  contentType: 'text' | 'image' | 'video'
  variantIndex?: number
  role: 'user' | 'assistant'
  parts: ConversationMessagePart[]
  model?: string
  replyToTurnId?: string
  replySnippet?: string
  routedModelId?: string
}
