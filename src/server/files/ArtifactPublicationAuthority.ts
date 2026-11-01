import 'server-only'

import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import type { ArtifactExecutionReference } from '@/shared/storage/file-publication'
import type { NativeHarnessAccess, NativeHarnessContext } from '@/server/harness/native-access'
import type { PersonalHarnessAccess } from '@/server/harness/personal-access'
import { getOverlayServerContext } from '@/server/bootstrap'

export type ArtifactPublicationAuthority =
  | { kind: 'native'; access: NativeHarnessAccess; context: NativeHarnessContext }
  | { kind: 'personal'; access: PersonalHarnessAccess;
    context: Omit<PersonalChatWorkToolingContext, 'entitlements' | 'paid'> }

export async function authorizeComputerPublication(options: {
  userId: string
  workspaceId?: string
  artifactPublicationAuthority?: ArtifactPublicationAuthority
}): Promise<ArtifactExecutionReference> {
  const authority = options.artifactPublicationAuthority
  if (!authority || authority.access.actorUserId !== options.userId
    || !options.workspaceId || authority.access.workspaceId !== options.workspaceId) {
    throw new Error('HARNESS_PUBLICATION_NOT_AUTHORIZED')
  }
  if (authority.kind === 'native') {
    const { refreshNativeHarnessAccess } = await import('@/server/harness/native-access')
    await refreshNativeHarnessAccess(authority.access, authority.context, 'computer_publish_file')
    await refreshNativeHarnessAccess(authority.access, authority.context, 'write_file')
  } else {
    const { refreshPersonalHarnessAccess } = await import('@/server/harness/personal-access')
    await refreshPersonalHarnessAccess(authority.access, authority.context, 'computer_publish_file')
    await refreshPersonalHarnessAccess(authority.access, authority.context, 'write_file')
  }
  const authorization = getOverlayServerContext().authorizationService
  const subject = await authorization.resolveSubject(options.userId)
  if (!authorization.checkResolvedCapability(subject, 'files.upload').allowed) {
    throw new Error('HARNESS_PUBLICATION_NOT_AUTHORIZED')
  }
  return {
    actorUserId: authority.access.actorUserId,
    runId: authority.access.runId,
    workflowRunId: authority.access.workflowRunId,
  }
}
