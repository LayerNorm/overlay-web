import 'server-only'

import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { lazyConvex } from '@/server/database/lazy-convex'
import { resolveConvexUrl } from '@/server/database/convex-url'
import { deploymentEnv } from '@/server/env/deployment-env'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { agentDriveAuthorityArgs, type AgentDriveAuthorityClaims } from '@/shared/agents/agent-drive-authority'
import type { AgentDriveScope } from '@/shared/agents/agent-drive-manifest'
import { driveMetadataResultSchema, type DriveMetadataOperation, type DriveMetadataResult } from './agent-drive-metadata'
import type { ResourceViewer } from '@/shared/workspaces/resource-scope'

export type AgentDriveManifestPage = { rows: unknown[]; scope: AgentDriveScope; viewer: ResourceViewer; nextCursor: string | null }
export interface AgentDriveManifestRepository {
  authorize(): Promise<void>
  /** All pages from this repository instance must describe the same database snapshot. */
  page(cursor: string | null): Promise<AgentDriveManifestPage>
  file(fileId: string, updatedAt: number): Promise<unknown>
  metadata(requestId: string, operation: DriveMetadataOperation): Promise<DriveMetadataResult>
}

/** One short-lived SDK client per manifest. Never share its pinned timestamp with another request. */
export function createAgentDriveManifestRepository(claims: AgentDriveAuthorityClaims): AgentDriveManifestRepository {
  const { url, invalid } = resolveConvexUrl(deploymentEnv())
  if (!url || invalid) throw Error('DRIVE_BACKEND_UNAVAILABLE')
  const args = { ...agentDriveAuthorityArgs(claims), serverSecret: getInternalApiSecret() }
  // Convex retains historical timestamps briefly. Abort before that window rather than mix snapshots.
  const signal = AbortSignal.timeout(20000)
  const client = new ConvexHttpClient(url, { logger: false, skipConvexDeploymentUrlCheck: true,
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }),
  })
  return {
    async authorize() {
      // A pinned snapshot cannot grant current authority: revocation is always read at current time.
      await lazyConvex.query('agents/agentDrive:authorizeByServer', args, { throwOnError: true })
    },
    async page(cursor) {
      return client.consistentQuery(makeFunctionReference<'query', Record<string, unknown>, AgentDriveManifestPage>('agents/agentDrive:manifestPageByServer'), {
        ...args, metadataOnly: true, ...(cursor === null ? {} : { cursor }),
      })
    },
    async file(fileId, updatedAt) {
      return lazyConvex.query('agents/agentDrive:fileByServer', { ...args, fileId, updatedAt }, { throwOnError: true })
    },
    async metadata(requestId, operation) {
      const result = driveMetadataResultSchema.safeParse(await lazyConvex.mutation('agents/agentDriveMetadata:commitByServer', { ...args, requestId, operation }, { throwOnError: true }))
      if (!result.success) throw Error('DRIVE_BACKEND_UNAVAILABLE')
      return result.data
    },
  }
}
