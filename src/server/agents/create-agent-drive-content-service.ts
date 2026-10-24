import 'server-only'
import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { checkGlobalR2Budget } from '@/server/storage/r2-budget'
import { agentDriveAuthorityArgs } from '@/shared/agents/agent-drive-authority'
import { createAgentDriveTokens } from './agent-drive-token'
import { AgentDriveContentService, driveContentResultSchema, driveUploadRecordSchema, type AgentDriveContentRepository } from './AgentDriveContentService'
import { connectedAgentDriveEnabled } from './create-agent-drive-service'

export function createAgentDriveContentService(): AgentDriveContentService {
  if (!connectedAgentDriveEnabled()) throw Error('DRIVE_DISABLED')
  const secret = process.env.OVERLAY_AGENT_DRIVE_SECRET?.trim() || process.env.INTERNAL_SERVICE_AUTH_SECRET?.trim()
    || process.env.INTERNAL_API_SECRET?.trim() || ''
  const tokens = createAgentDriveTokens({ secret })
  const store = getOverlayServerContext().objectStore
  if (!store.downloadBuffer) throw Error('DRIVE_BOUNDED_STORAGE_UNAVAILABLE')
  if (!store.uploadBuffer) throw Error('DRIVE_WRITABLE_STORAGE_UNAVAILABLE')
  return new AgentDriveContentService({ secret, verifyToken: token => tokens.verify(token),
    repository(claims): AgentDriveContentRepository {
      const authority = { ...agentDriveAuthorityArgs(claims), serverSecret: getInternalApiSecret() }
      return {
        async authorize() { await lazyConvex.query('agents/agentDrive:authorizeByServer', authority, { throwOnError: true }) },
        async intent(input) {
          return driveUploadRecordSchema.parse(await lazyConvex.mutation('agents/agentDriveUploads:intentByServer', { ...authority, ...input }, { throwOnError: true }))
        },
        async read(uploadId) {
          return driveUploadRecordSchema.parse(await lazyConvex.query('agents/agentDriveUploads:readByServer', { ...authority, uploadId }, { throwOnError: true }))
        },
        async commit(input) {
          return driveContentResultSchema.parse(await lazyConvex.mutation('agents/agentDriveUploads:commitByServer', { ...authority, ...input }, { throwOnError: true }))
        },
      }
    },
    storage: {
      checkBudget: checkGlobalR2Budget,
      discard: key => store.deleteObject(key),
      async uploadUrl(key, mime, bytes, sha256, ttlSeconds) {
        return (await store.getUploadUrl(key, mime, { contentLength: bytes,
          checksumSha256: sha256, expiresIn: ttlSeconds })).url
      },
      async read(key, maximumBytes) {
        if (!store.downloadBuffer) throw Error('DRIVE_BOUNDED_STORAGE_UNAVAILABLE')
        return store.downloadBuffer(key, maximumBytes)
      },
      async seal(key, bytes, mime) {
        if (!store.uploadBuffer) throw Error('DRIVE_WRITABLE_STORAGE_UNAVAILABLE')
        await store.uploadBuffer(key, bytes, mime)
      },
    },
  })
}
