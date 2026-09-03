import 'server-only'

import type { getOverlayServerContext } from '@/server/bootstrap'
import { PlatformAgentAccess } from '@/server/agents/PlatformAgentAccess'
import {
  resolveWorkspaceAgentInvocations,
  runWorkspaceAgentTurn,
} from '@/server/agents/workspace-agent-invocation'
import { decryptPlatformToken } from './slack-token-crypto'
import { loadSlackApi } from './slack-adapter-modules'
import type { SlackBotDeps } from './SlackWebhookService'

type ServerContext = ReturnType<typeof getOverlayServerContext>

/** Live dependency wiring for the Slack bot seam (route entry points only). */
export function buildSlackBotDeps(server: ServerContext): SlackBotDeps {
  const access = new PlatformAgentAccess({
    governance: server.workspaceGovernanceService,
    workspaceAgents: server.workspaceAgentService,
    collaboration: server.appData.repositories.conversationCollaboration,
  })
  return {
    access,
    collaboration: server.appData.repositories.conversationCollaboration,
    governance: server.workspaceGovernanceService,
    workspaceAgents: server.workspaceAgentService,
    runTurn: runWorkspaceAgentTurn,
    resolveInvocations: resolveWorkspaceAgentInvocations,
    postMessage: (...args) => loadSlackApi().then(({ postSlackMessage }) => postSlackMessage(...args)),
    decryptToken: (cipher: string) => decryptPlatformToken({
      cipher,
      keyBase64: slackEncryptionKey(),
    }),
    assertLimits: async ({ workspaceId, principalId, conversationId }) => {
      await server.workspaceGovernanceService.assertWithinLimits({
        action: 'message.send',
        scope: { workspaceId, principalId, conversationId },
      })
    },
  }
}

function slackEncryptionKey(): string {
  const key = process.env.SLACK_ENCRYPTION_KEY?.trim()
  if (!key) throw new Error('SLACK_ENCRYPTION_KEY is not configured')
  return key
}
