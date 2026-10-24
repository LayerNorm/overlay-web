import 'server-only'
import {lazyConvex} from '@/server/database/lazy-convex'
import {getInternalApiSecret} from '@/server/shared/internal-api-secret'
import {agentDriveAuthorityArgs} from '@/shared/agents/agent-drive-authority'
import {createAgentDriveTokens} from './agent-drive-token'
import {connectedAgentDriveEnabled} from './create-agent-drive-service'
import {AgentDriveRecoveryService} from './AgentDriveRecoveryService'

export function createAgentDriveRecoveryService(): AgentDriveRecoveryService {
  if (!connectedAgentDriveEnabled()) throw Error('DRIVE_DISABLED')
  const secret = process.env.OVERLAY_AGENT_DRIVE_SECRET?.trim() || process.env.INTERNAL_SERVICE_AUTH_SECRET?.trim()
    || process.env.INTERNAL_API_SECRET?.trim() || ''
  const tokens = createAgentDriveTokens({secret})
  return new AgentDriveRecoveryService({verifyToken: token => tokens.verify(token),
    read: (claims, request) => lazyConvex.query('agents/agentDriveRecovery:readByServer', {
      ...agentDriveAuthorityArgs(claims), serverSecret: getInternalApiSecret(), request,
    }, {throwOnError: true}),
  })
}
