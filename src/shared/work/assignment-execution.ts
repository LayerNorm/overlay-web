export type AssignmentOrigin = {
  platform: 'slack'
  channelId: string
  channelName?: string
  threadLinkId: string
}

export type AssignmentExecution = {
  kind: 'agent_assignment'
  assignmentId: string
  attemptId?: string
  conversationId: string
  agentId: string
  agentName: string
  title: string
  scope: 'personal' | 'workspace'
  status: string
  disposition?: 'accepted' | 'revision_requested' | 'excluded'
  dispositionReason?: string
  parent: { conversationId: string; agentId: string; title: string; scope: 'personal' | 'workspace' }
  origin?: AssignmentOrigin
}
