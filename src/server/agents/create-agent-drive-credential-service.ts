import 'server-only'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { AgentDriveCredentialService } from './AgentDriveCredentialService'
import { connectedAgentDriveEnabled } from './create-agent-drive-service'
import { externalAgentLaunchEnabled } from './external-agent-policy'

export function createAgentDriveCredentialService() {
  if (!connectedAgentDriveEnabled()) throw Error('DRIVE_DISABLED')
  return new AgentDriveCredentialService({
    enabled: connectedAgentDriveEnabled,
    launchEnabled: externalAgentLaunchEnabled,
    secret: process.env.OVERLAY_AGENT_DRIVE_SECRET?.trim() || process.env.INTERNAL_SERVICE_AUTH_SECRET?.trim()
      || process.env.INTERNAL_API_SECRET?.trim() || '',
    lookup: input => lazyConvex.query('agents/agentDrive:credentialAuthorityByServer',
      { serverSecret: getInternalApiSecret(), ...input }, { throwOnError: true }),
  })
}
