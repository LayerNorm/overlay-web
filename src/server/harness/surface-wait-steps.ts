import 'server-only'

import type { PersonalHarnessAccess } from './personal-access'
import type { HarnessWaitProjection } from './delivery-wait-projection'
import { assertSurfaceAdmissionSource, refreshSurfaceHarnessSource } from './surface-access'
import { surfaceHarnessTurnId } from './surface-authority'
import { postSlackAgentMessage } from '@/server/surfaces/slack-reply'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'

export async function deliverSurfaceWaitNoticeStep(input: {
  access: PersonalHarnessAccess
  context: Pick<PersonalChatWorkToolingContext,
    'turnId' | 'accountAllowedToolIds' | 'accountAllowedConnectorIds' | 'integrationToolIds'>
  placeholderTs: string
  projection: HarnessWaitProjection
}): Promise<void> {
  'use step'
  if (input.access.authentication.type !== 'surface') return
  const authority = input.access.authentication
  const source = await assertSurfaceAdmissionSource({
    actorUserId: input.access.actorUserId,
    workspaceId: input.access.workspaceId,
    turnId: surfaceHarnessTurnId(authority),
    surface: authority,
  })
  await refreshSurfaceHarnessSource(input.access, input.context, input.access.workflowRunId)
  const { getBaseUrl } = await import('@/server/web/app-url')
  const link = `${getBaseUrl()}${buildWorkspaceHref(
    input.access.workspaceId,
    `/app/chat?${new URLSearchParams({ id: input.access.conversationId, view: 'channels' })}`,
  )}`
  const text = 'wait' in input.projection
    ? input.projection.wait.kind === 'approval'
      ? `This task needs approval in Overlay. Open ${link} to approve or deny it; a Slack reply will not resume the task.`
      : `This task needs input in Overlay. Open ${link} to respond; a Slack reply will not resume the task.`
    : 'Working…'
  const { getSlackAdapter } = await import(
    /* step-only */ '@/server/surfaces/chat'
  )
  await postSlackAgentMessage({
    adapter: await getSlackAdapter(),
    teamId: authority.teamId,
    channelId: authority.channelId,
    threadTs: authority.threadId || undefined,
    text,
    agentName: source.agent.name,
    editTs: input.placeholderTs,
  })
}
