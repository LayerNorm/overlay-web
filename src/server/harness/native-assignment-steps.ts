import 'server-only'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { NativeHarnessAccess } from './native-access'

export async function readNativeAssignmentIssues(access: NativeHarnessAccess) {
  'use step'
  return await new ConvexHarnessRepository().readAssignmentIssues({ actorUserId: access.actorUserId, parentRunId: access.runId })
}
