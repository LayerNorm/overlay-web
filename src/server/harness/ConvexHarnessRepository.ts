import 'server-only'

import type {
  HarnessAdmission,
  HarnessMutationInput,
  HarnessMutationResult,
  HarnessRepository,
  HarnessWait,
  HarnessWaitReference,
  HarnessWaitRequest,
} from '@overlay/agent-runtime/harness-store'
import type { HarnessEvidence, HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export class ConvexHarnessRepository implements HarnessRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async admit(input: HarnessAdmission): Promise<HarnessSnapshot> {
    const snapshot = await convex.mutation<HarnessSnapshot>('harness/runs:admit', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!snapshot) throw new Error('Harness admission returned no snapshot.')
    return snapshot
  }

  async get(input: { actorUserId: string; runId: string }): Promise<HarnessSnapshot | null> {
    return await convex.query<HarnessSnapshot | null>('harness/runs:get', {
      actorUserId: input.actorUserId, runId: input.runId,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async apply(input: HarnessMutationInput): Promise<HarnessMutationResult> {
    const result = await convex.mutation<HarnessMutationResult>('harness/runs:apply', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!result) throw new Error('Harness mutation returned no result.')
    return result
  }

  async readEvidence(
    input: { actorUserId: string; runId: string; evidenceId: string },
  ): Promise<HarnessEvidence | null> {
    return await convex.query<HarnessEvidence | null>('harness/runs:readEvidence', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async publishWait(
    input: HarnessWaitReference & { request: HarnessWaitRequest },
  ): Promise<HarnessWait> {
    const wait = await convex.mutation<HarnessWait>('harness/runs:publishWait', {
      actorUserId: input.actorUserId, runId: input.runId, workflowRunId: input.workflowRunId, request: input.request,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!wait) throw new Error('Harness wait publication returned no wait.')
    return wait
  }

  async resolveWait(input: HarnessWaitReference & { token: string }): Promise<void> {
    await convex.mutation<void>('harness/runs:resolveWait', {
      actorUserId: input.actorUserId, runId: input.runId, workflowRunId: input.workflowRunId, token: input.token,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async listPendingWaits(input: HarnessWaitReference): Promise<HarnessWait[]> {
    const waits = await convex.query<HarnessWait[]>('harness/runs:listPendingWaits', {
      actorUserId: input.actorUserId, runId: input.runId, workflowRunId: input.workflowRunId,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
    if (!waits) throw new Error('Harness pending wait query returned no result.')
    return waits
  }
}
