import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import type { ToolSet } from 'ai'

/**
 * The agent's Overlay tools in a private thread (memory, files, notes, tasks, web search…), served by Overlay's MCP
 * server at `/api/mcp`. Overlay Desktop gets a short-lived token for this person, workspace and agent before each turn;
 * each tool call sends only what that tool needs, never the conversation. Which tools come back is decided by the
 * server: the agent's grant in a paid workspace, the free tier otherwise.
 */
export type OverlayToolsConnection = {
  tools: ToolSet
  /** What the server says about these tools, for the agent's instructions. */
  instructions: string
  close: () => Promise<void>
}

export type OverlayToolsAccess = { url: string; token: string }

const CONNECT_TIMEOUT_MS = 15_000

/** Never fails the turn: without Overlay's tools the thread still has this computer's. */
export async function connectOverlayTools(
  access: OverlayToolsAccess | undefined,
  options: { signal: AbortSignal; onUnavailable?: (reason: string) => void; connect?: typeof createMCPClient },
): Promise<OverlayToolsConnection | null> {
  if (!access) return null
  let client: MCPClient | null = null
  try {
    client = await (options.connect ?? createMCPClient)({
      transport: { type: 'http', url: access.url, headers: { Authorization: `Bearer ${access.token}` }, redirect: 'error' },
      // Overlay's server is stateless and answers `initialize` directly.
      protocolVersionDiscovery: false,
      clientName: 'overlay-private-thread',
      initializationOptions: { signal: AbortSignal.any([options.signal, AbortSignal.timeout(CONNECT_TIMEOUT_MS)]) },
    })
    const tools = await client.tools() as ToolSet
    const connected = client
    return {
      tools,
      instructions: connected.instructions?.trim() ?? '',
      close: async () => { await connected.close().catch(() => undefined) },
    }
  } catch (error) {
    await client?.close().catch(() => undefined)
    options.onUnavailable?.(error instanceof Error ? error.message : String(error))
    return null
  }
}

/** This computer's tools win a name clash: they are what the thread runs on. */
export function withOverlayTools(computerTools: ToolSet, overlay: OverlayToolsConnection | null): ToolSet {
  if (!overlay) return computerTools
  const merged: ToolSet = {}
  for (const [name, definition] of Object.entries(overlay.tools)) {
    if (!(name in computerTools)) merged[name] = definition
  }
  return { ...merged, ...computerTools }
}
