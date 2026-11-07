/** One row of the chat sidebar list: a channel, direct message or AI chat, as the live room list returns it. */
export type ChatListConversation = {
  _id: string
  title: string
  lastModified: number
  createdAt?: number
  updatedAt?: number
  lastMode?: 'ask' | 'act'
  askModelIds?: string[]
  modelIds?: string[]
  actModelId?: string
  workspaceId?: string
  conversationType?: 'personal' | 'dm' | 'channel'
  scope?: 'personal' | 'workspace'
  otherParticipantTypes?: Array<'human' | 'agent'>
  createdByPrincipalId?: string
  externalPlatform?: string
}
