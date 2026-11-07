export type AssignmentResultView = {
  assignmentId: string
  attemptId: string
  conversationId: string
  turnId: string
  childRunId?: string
  superseded: boolean
  state: 'working' | 'publication_pending' | 'ready'
  runStatus: string
  terminal: boolean
  summary: string
  blocker?: unknown
  reply?: string
  failureReason?: string
  artifactRefs: Array<{ artifactId: string; runId: string; expiresAt: number; resource?: { id: string; revision?: string; operation?: string; page?: number } }>
}
