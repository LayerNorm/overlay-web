export type SurfaceHarnessIdentity = {
  platform: string
  bindingId: string
  connectionId: string
  teamId: string
  channelId: string
  threadId: string
  messageId: string
  agentId: string
  agentPrincipalId?: string
  creatorPrincipalId?: string
}

export type SurfaceHarnessAuthentication = SurfaceHarnessIdentity & {
  type: 'surface'
  platform: 'slack'
  agentPrincipalId: string
  creatorPrincipalId: string
  originWorkflowRunId: string
}

export function surfaceHarnessTurnId(source: Pick<SurfaceHarnessIdentity, 'bindingId' | 'messageId'>): string {
  return `surface:slack:${source.bindingId}:${source.messageId}`
}
