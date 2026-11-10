import { slackSurfaceTurnId } from '@/shared/surfaces/surface-turn-identity'

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
  identityLinkId?: string
  slackUserId?: string
}

export type SurfaceHarnessAuthentication = SurfaceHarnessIdentity & {
  type: 'surface'
  platform: 'slack'
  agentPrincipalId: string
  creatorPrincipalId: string
  originWorkflowRunId: string
}

export function surfaceHarnessTurnId(source: Pick<SurfaceHarnessIdentity, 'teamId' | 'channelId' | 'messageId'>): string {
  return slackSurfaceTurnId(source)
}
