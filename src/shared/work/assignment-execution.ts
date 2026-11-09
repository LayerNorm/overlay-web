export type AssignmentOrigin = {
  platform: 'slack'
  channelId: string
  channelName?: string
  threadLinkId: string
}

/** The assigned agent's avatar, as the Work Avatar draws it. */
export type AssignmentAgent = {
  avatarColor?: string
  avatarShape?: string
  isDefault?: boolean
}

export type AssignmentExecution = {
  kind: 'agent_assignment'
  assignmentId: string
  attemptId?: string
  attemptOrdinal?: number
  conversationId: string
  agentId: string
  agentName: string
  agent: AssignmentAgent
  title: string
  brief: string
  scope: 'personal' | 'workspace'
  status: string
  disposition?: 'accepted' | 'revision_requested' | 'excluded'
  dispositionReason?: string
  result?: { summary: string; failureReason?: string }
  parent: { conversationId: string; agentId: string; title: string; scope: 'personal' | 'workspace' }
  origin?: AssignmentOrigin
  createdAt: number
}
