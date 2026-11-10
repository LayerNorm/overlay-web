import 'server-only'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { NativeHarnessAccess } from './native-access'

export async function readNativeAssignmentIssues(access: NativeHarnessAccess) {
  'use step'
  return await new ConvexHarnessRepository().readAssignmentIssues({ actorUserId: access.actorUserId, parentRunId: access.runId })
}

export async function readNativeAssignmentChild(access: NativeHarnessAccess, assignmentId: string) {
  'use step'
  return await new ConvexHarnessRepository().readAssignmentChild({ actorUserId: access.actorUserId,
    workspaceId: access.workspaceId, parentRunId: access.runId, assignmentId })
}
