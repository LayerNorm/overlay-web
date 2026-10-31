export type SurfaceTurnExecution = {
  turnId: string
  workflowRunId: string
  actorUserId: string
  workspaceId: string
  creatorPrincipalId: string
  agentId: string
  agentPrincipalId: string
  platform: 'slack'
  teamId: string
  channelId: string
  threadId: string
  messageId: string
  bindingId: string
  connectionId: string
  conversationId: string
  agentRunId: string
  userMessageId: string
  assistantMessageId: string
  harnessRunId: string
  placeholderTs?: string
  createdAt: number
  updatedAt: number
}
