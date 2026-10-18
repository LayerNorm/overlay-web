import 'server-only'
import { AgentDriveDownloadCache } from './agent-drive-download-cache'


import { getOverlayRuntimeConfigSync } from '@/server/config'
import { createAgentDriveTokens } from './agent-drive-token'
import { createAgentDriveManifestRepository } from './AgentDriveManifestRepository'
import { AgentDriveManifestService } from './AgentDriveManifestService'
import { AgentDriveMaterializer } from './AgentDriveMaterializer'
import { createAgentDriveStorageReader } from './AgentDriveStorageReader'

const verifiedDownloads = new AgentDriveDownloadCache()

export function connectedAgentDriveEnabled(): boolean {
  const features = getOverlayRuntimeConfigSync().features
  return features.connectedAgentControlPlane === true && features.connectedAgentDrive === true
}

export function createAgentDriveService(): AgentDriveManifestService {
  if (!connectedAgentDriveEnabled()) throw Error('DRIVE_DISABLED')
  const secret = process.env.OVERLAY_AGENT_DRIVE_SECRET?.trim() || process.env.INTERNAL_SERVICE_AUTH_SECRET?.trim()
    || process.env.INTERNAL_API_SECRET?.trim() || ''
  const tokens = createAgentDriveTokens({ secret })
  return new AgentDriveManifestService({
    secret, downloads: verifiedDownloads, verifyToken: token => tokens.verify(token), repository: createAgentDriveManifestRepository,
    materializer: claims => new AgentDriveMaterializer(createAgentDriveStorageReader(claims)),
  })
}
