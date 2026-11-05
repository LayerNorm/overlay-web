import 'server-only'

import { randomUUID } from 'node:crypto'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

export type McpCommandKind = 'test' | 'connect' | 'disconnect'
export type McpCommandId = string

export async function beginMcpCommand(args: {
  mcpServerId: string
  userId: string
  workspaceId: string
  kind: McpCommandKind
}): Promise<McpCommandId> {
  const commandId = randomUUID()
  const started = await convex.mutation<string>('integrations/mcpCommands:begin', {
    ...args,
    commandId,
    serverSecret: getInternalApiSecret(),
  }, { throwOnError: true })
  if (!started) throw new Error('MCP_COMMAND_START_FAILED')
  return started
}

export async function finishMcpCommand(args: {
  mcpServerId: string
  userId: string
  workspaceId: string
  commandId: McpCommandId
  status: 'succeeded' | 'failed'
  toolCount?: number
}): Promise<void> {
  await convex.mutation('integrations/mcpCommands:finish', {
    ...args,
    serverSecret: getInternalApiSecret(),
  }, { throwOnError: true })
}
