import 'server-only'

import type {
  HarnessAdmission,
  HarnessMutationInput,
  HarnessMutationResult,
  HarnessRepository,
} from '@overlay/agent-runtime/harness-store'
import type { HarnessEvidence, HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export class ConvexHarnessRepository implements HarnessRepository {
  private get serverSecret(): string {
    return getInternalApiSecret()
  }

  async admit(input: HarnessAdmission): Promise<HarnessSnapshot> {
    return await convex.mutation<HarnessSnapshot>('harness/runs:admit', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async get(input: { actorUserId: string; runId: string }): Promise<HarnessSnapshot | null> {
    return await convex.query<HarnessSnapshot | null>('harness/runs:get', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async apply(input: HarnessMutationInput): Promise<HarnessMutationResult> {
    return await convex.mutation<HarnessMutationResult>('harness/runs:apply', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }

  async readEvidence(
    input: { actorUserId: string; runId: string; evidenceId: string },
  ): Promise<HarnessEvidence | null> {
    return await convex.query<HarnessEvidence | null>('harness/runs:readEvidence', {
      ...input,
      serverSecret: this.serverSecret,
    }, { throwOnError: true })
  }
}
