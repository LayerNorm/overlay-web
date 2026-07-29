import 'server-only'

import { createHash } from 'node:crypto'
import { logger } from '@/server/observability/logger'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { jsonSchemaToZod } from './mcp-schema-to-zod'
import { fireAndForgetRecordToolInvocation } from './tools/record-tool-invocation'
import { validatePublicNetworkUrl } from '@/server/security/ssrf'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { McpServerRepository, McpToolPolicyMode } from '@/server/extensions'
import { resolveMcpToolPolicy } from '@/server/extensions'

// Dynamic import of MCP SDK (ESM)
type McpClientModule = typeof import('@modelcontextprotocol/sdk/client/index.js')
type McpSseModule = typeof import('@modelcontextprotocol/sdk/client/sse.js')
type McpStreamableHttpModule = typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js')
type McpTypesModule = typeof import('@modelcontextprotocol/sdk/types.js')

let mcpModules:
  | {
      Client: McpClientModule['Client']
      SSEClientTransport: McpSseModule['SSEClientTransport']
      StreamableHTTPClientTransport: McpStreamableHttpModule['StreamableHTTPClientTransport']
      ListToolsResultSchema: McpTypesModule['ListToolsResultSchema']
      CallToolResultSchema: McpTypesModule['CallToolResultSchema']
    }
  | undefined

async function loadMcpModules() {
  if (mcpModules) return mcpModules
  const [
    clientMod,
    sseMod,
    httpMod,
    typesMod,
  ] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/sse.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/types.js'),
  ])
  mcpModules = {
    Client: clientMod.Client,
    SSEClientTransport: sseMod.SSEClientTransport,
    StreamableHTTPClientTransport: httpMod.StreamableHTTPClientTransport,
    ListToolsResultSchema: typesMod.ListToolsResultSchema,
    CallToolResultSchema: typesMod.CallToolResultSchema,
  }
  return mcpModules
}

export interface McpServerConfig {
  _id: string
  userId: string
  name: string
  description?: string
  transport: 'sse' | 'streamable-http'
  url: string
  enabled: boolean
  authType: 'none' | 'bearer' | 'header'
  authConfig?: {
    bearerToken?: string
    headerName?: string
    headerValue?: string
  }
  timeoutMs?: number
  projectId?: string
  defaultToolPolicy: McpToolPolicyMode
  toolPolicies: Record<string, McpToolPolicyMode>
  toolCatalog?: McpToolCatalogEntry[]
}

function getMcpRepository(): McpServerRepository {
  return getOverlayServerContext().appData.repositories.mcpServers
}

async function listRuntimeMcpServers(args: {
  userId: string
  projectId?: string
  enabledServerIds?: readonly string[]
}) {
  const repository = getMcpRepository()
  const [global, project] = await Promise.all([
    repository.listEnabled({ userId: args.userId }),
    args.projectId
      ? repository.listEnabled({ userId: args.userId, projectId: args.projectId })
      : Promise.resolve([]),
  ])
  const servers = [...global, ...project]
  if (args.enabledServerIds === undefined) return servers
  const enabled = new Set(args.enabledServerIds)
  return servers.filter((server) => enabled.has(server._id))
}

async function recordMcpExecution(input: {
  args: {
    userId: string
    conversationId?: string
    turnId?: string
    modelId?: string
  }
  config: McpServerConfig
  toolName: string
  toolArgs: unknown
  policyDecision: McpToolPolicyMode
  status: 'succeeded' | 'failed' | 'denied'
  durationMs?: number
  errorMessage?: string
}): Promise<void> {
  await getMcpRepository().recordExecution({
    userId: input.args.userId,
    projectId: input.config.projectId,
    mcpServerId: input.config._id,
    toolName: input.toolName,
    argumentsHash: createHash('sha256')
      .update(JSON.stringify(input.toolArgs ?? null))
      .digest('hex'),
    policyDecision: input.policyDecision,
    status: input.status,
    conversationId: input.args.conversationId,
    turnId: input.args.turnId,
    modelId: input.args.modelId,
    durationMs: input.durationMs,
    errorMessage: input.errorMessage,
  })
}

type McpCacheEntry = {
  tools: ToolSet
  createdAt: number
}
const mcpCache = new Map<string, McpCacheEntry>()
const mcpInFlight = new Map<string, Promise<ToolSet>>()
const MCP_CACHE_TTL_MS = 60_000 // 60 seconds

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function safeToolId(serverName: string, toolName: string): string {
  return `mcp_${slugify(serverName)}_${slugify(toolName)}`
}

function buildAuthHeaders(config: McpServerConfig): Record<string, string> {
  const headers: Record<string, string> = {}
  if (config.authType === 'bearer' && config.authConfig?.bearerToken) {
    headers['Authorization'] = `Bearer ${config.authConfig.bearerToken}`
  }
  if (config.authType === 'header' && config.authConfig?.headerName && config.authConfig?.headerValue) {
    headers[config.authConfig.headerName] = config.authConfig.headerValue
  }
  return headers
}

async function createMcpTransportAndClient(config: McpServerConfig) {
  const {
    Client,
    SSEClientTransport,
    StreamableHTTPClientTransport,
  } = await loadMcpModules()

  const validation = await validatePublicNetworkUrl(config.url, { allowLocalDev: true, requireHttps: true })
  if (!validation.ok) throw new Error(validation.error)
  const url = validation.url
  const headers = buildAuthHeaders(config)
  const timeoutMs = config.timeoutMs ?? 30_000

  let transport: { start(): Promise<void>; close(): Promise<void>; send(message: unknown): Promise<void> } | undefined

  if (config.transport === 'sse') {
    transport = new SSEClientTransport(url, {
      requestInit: { headers },
      eventSourceInit: { headers } as EventSourceInit,
    } as import('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransportOptions)
  } else {
    transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
    } as import('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransportOptions)
  }

  const client = new Client(
    { name: 'overlay-web', version: '0.1.0' },
    { capabilities: {} }
  )

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await client.connect(transport as import('@modelcontextprotocol/sdk/shared/transport.js').Transport)
  } finally {
    clearTimeout(timeoutId)
  }

  return { client, transport, timeoutMs }
}

const MAX_MCP_TOOL_RESULT_CHARS = 50_000 // Truncate to prevent AI Gateway token limit errors

export interface McpToolCatalogEntry {
  name: string
  description?: string
  inputSchema?: unknown
}

function flattenMcpToolResult(result: { isError?: boolean; content: unknown }): string {
  const content = result.content
  let resultText: string
  if (Array.isArray(content) && content.length > 0) {
    const textParts = content
      .filter((c): c is { type: string; text?: string } =>
        typeof c === 'object' && c !== null
      )
      .map((c) => c.text)
      .filter((t): t is string => typeof t === 'string')
    if (textParts.length > 0) {
      resultText = textParts.join('\n')
    } else {
      resultText = JSON.stringify(content)
    }
  } else {
    resultText = JSON.stringify(result)
  }
  if (resultText.length > MAX_MCP_TOOL_RESULT_CHARS) {
    logger.warn(`[MCP] Truncating tool result from ${resultText.length} to ${MAX_MCP_TOOL_RESULT_CHARS} chars`)
    resultText = resultText.slice(0, MAX_MCP_TOOL_RESULT_CHARS) + '\n\n[Result truncated due to length]'
  }
  return resultText
}

export async function discoverToolsCatalogForServer(
  config: McpServerConfig,
): Promise<McpToolCatalogEntry[]> {
  const { client, timeoutMs } = await createMcpTransportAndClient(config)
  try {
    const toolsResult = await client.listTools({}, { signal: AbortSignal.timeout(timeoutMs) })
    return (toolsResult.tools ?? [])
      .filter((t) => typeof t.name === 'string' && t.name.length > 0)
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
  } finally {
    try {
      await client.close()
    } catch (_error) {
      // ignore close errors
    }
  }
}

export async function persistMcpServerToolCatalog(args: {
  mcpServerId: string
  userId: string
  accessToken?: string
  serverSecret?: string
  tools: McpToolCatalogEntry[]
  catalogError?: string
}): Promise<void> {
  await getMcpRepository().updateToolCatalog({
    mcpServerId: args.mcpServerId,
    userId: args.userId,
    tools: args.tools,
    catalogError: args.catalogError,
  })
}

export async function refreshMcpServerToolCatalog(args: {
  mcpServerId: string
  userId: string
  accessToken?: string
  serverSecret?: string
}): Promise<{ toolCount: number; error?: string }> {
  const config = await getMcpRepository().get(args)
  if (!config) {
    return { toolCount: 0, error: 'MCP server not found' }
  }
  try {
    const tools = await discoverToolsCatalogForServer(config)
    await persistMcpServerToolCatalog({
      ...args,
      tools,
      catalogError: undefined,
    })
    return { toolCount: tools.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await persistMcpServerToolCatalog({
      ...args,
      tools: [],
      catalogError: message,
    }).catch((_error) => undefined)
    return { toolCount: 0, error: message }
  }
}

export function rankMcpCatalogEntries(
  entries: Array<McpToolCatalogEntry & { serverId: string; serverName: string }>,
  query: string,
  limit: number,
): Array<McpToolCatalogEntry & { serverId: string; serverName: string; score: number }> {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return entries.slice(0, limit).map((entry) => ({ ...entry, score: 0 }))
  }
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  const scored = entries.map((entry) => {
    const haystack = `${entry.name} ${entry.description ?? ''} ${entry.serverName}`.toLowerCase()
    let score = 0
    if (entry.name.toLowerCase() === normalizedQuery) score += 100
    if (entry.name.toLowerCase().includes(normalizedQuery)) score += 40
    for (const token of tokens) {
      if (entry.name.toLowerCase().includes(token)) score += 20
      if (haystack.includes(token)) score += 5
    }
    return { ...entry, score }
  })
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.serverName.localeCompare(b.serverName) || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export async function createMcpLazyMetaTools(args: {
  userId: string
  accessToken?: string
  serverSecret?: string
  conversationId?: string
  turnId?: string
  modelId?: string
  projectId?: string
  enabledServerIds?: readonly string[]
}): Promise<ToolSet> {
  const configs = await listRuntimeMcpServers({
    userId: args.userId,
    projectId: args.projectId,
    enabledServerIds: args.enabledServerIds,
  })

  if (!configs || configs.length === 0) {
    return {}
  }

  const configById = new Map(configs.map((config) => [config._id, config]))

  const searchMcpTools = tool({
    description:
      'Search the user\'s enabled MCP integrations for tools by capability. Returns server id, tool name, and description. Call call_mcp_tool with exact names from results.',
    inputSchema: z.object({
      query: z.string().describe('What capability or task you need, e.g. "create issue" or "fetch weather"'),
      serverId: z.string().optional().describe('Optional MCP server id to restrict search'),
      limit: z.number().int().min(1).max(25).optional().describe('Max results (default 10)'),
    }),
    execute: async ({ query, serverId, limit }) => {
      const scoped = serverId
        ? configs.filter((config) => config._id === serverId)
        : configs
      if (scoped.length === 0) {
        return JSON.stringify({ results: [], message: 'No matching enabled MCP servers.' })
      }

      const catalogEntries = scoped.flatMap((config) =>
        config.toolCatalog
          .filter((entry) => resolveMcpToolPolicy(config, entry.name) !== 'deny')
          .map((entry) => ({
          ...entry,
          serverId: config._id,
          serverName: config.name,
        })),
      )

      if (catalogEntries.length === 0) {
        return JSON.stringify({
          results: [],
          message:
            'No cached MCP tool catalog for the selected server(s). Ask the user to test the connection in MCP settings to refresh the catalog.',
        })
      }

      const ranked = rankMcpCatalogEntries(catalogEntries, query, limit ?? 10)
      return JSON.stringify({
        results: ranked.map(({ serverId: sid, serverName, name, description, score }) => ({
          serverId: sid,
          serverName,
          toolName: name,
          description,
          score,
          policy: resolveMcpToolPolicy(configById.get(sid)!, name),
        })),
      })
    },
  })

  const callMcpToolMeta = tool({
    description:
      'Invoke an MCP tool on a connected server. Use search_mcp_tools first to get serverId and toolName.',
    inputSchema: z.object({
      serverId: z.string().describe('MCP server id from search_mcp_tools'),
      toolName: z.string().describe('Exact MCP tool name from search_mcp_tools'),
      arguments: z.record(z.string(), z.unknown()).optional().describe('Tool arguments object'),
    }),
    needsApproval: ({ serverId, toolName }) => {
      const config = configById.get(serverId)
      return config ? resolveMcpToolPolicy(config, toolName) === 'approval_required' : false
    },
    execute: async ({ serverId, toolName, arguments: toolArgs }) => {
      const config = configById.get(serverId)
      if (!config) {
        throw new Error('MCP server not found or not enabled')
      }
      const catalog = config.toolCatalog ?? []
      const catalogHit = catalog.some((entry) => entry.name === toolName)
      if (catalog.length > 0 && !catalogHit) {
        throw new Error(`Tool "${toolName}" is not in the cached catalog for server "${config.name}". Run search_mcp_tools again.`)
      }

      const policyDecision = resolveMcpToolPolicy(config, toolName)
      if (policyDecision === 'deny') {
        await recordMcpExecution({
          args,
          config,
          toolName,
          toolArgs: toolArgs ?? {},
          policyDecision,
          status: 'denied',
        })
        throw new Error(`Tool "${toolName}" is denied by this MCP server's policy`)
      }

      const toolId = safeToolId(config.name, toolName)
      const start = Date.now()
      try {
        const result = await callMcpTool(config, toolName, toolArgs ?? {})
        await recordMcpExecution({
          args,
          config,
          toolName,
          toolArgs: toolArgs ?? {},
          policyDecision,
          status: result.isError ? 'failed' : 'succeeded',
          durationMs: Date.now() - start,
          errorMessage: result.isError ? 'Tool returned error flag' : undefined,
        })
        void fireAndForgetRecordToolInvocation({
          userId: args.userId,
          toolName: toolId,
          mode: 'act',
          modelId: args.modelId,
          conversationId: args.conversationId,
          turnId: args.turnId,
          success: !result.isError,
          durationMs: Date.now() - start,
          error: result.isError ? 'Tool returned error flag' : undefined,
        })
        return flattenMcpToolResult(result)
      } catch (err) {
        await recordMcpExecution({
          args,
          config,
          toolName,
          toolArgs: toolArgs ?? {},
          policyDecision,
          status: 'failed',
          durationMs: Date.now() - start,
          errorMessage: err instanceof Error ? err.message : String(err),
        }).catch((_error) => undefined)
        void fireAndForgetRecordToolInvocation({
          userId: args.userId,
          toolName: toolId,
          mode: 'act',
          modelId: args.modelId,
          conversationId: args.conversationId,
          turnId: args.turnId,
          success: false,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    },
  })

  return {
    search_mcp_tools: searchMcpTools,
    call_mcp_tool: callMcpToolMeta,
  }
}

async function callMcpTool(
  config: McpServerConfig,
  toolName: string,
  input: unknown
): Promise<{ isError?: boolean; content: unknown }> {
  logger.info(`[MCP] Calling tool ${toolName} on server ${config.name}`)
  const { client, timeoutMs } = await createMcpTransportAndClient(config)
  try {
    const result = await client.callTool(
      { name: toolName, arguments: input as Record<string, unknown> },
      undefined,
      { signal: AbortSignal.timeout(timeoutMs) }
    )
    logger.info(`[MCP] Tool ${toolName} on server ${config.name} returned (isError=${result.isError})`)
    return result as { isError?: boolean; content: unknown }
  } catch (err) {
    logger.error(`[MCP] Tool ${toolName} on server ${config.name} failed: ${err instanceof Error ? err.message : String(err)}`)
    throw err
  } finally {
    try {
      await client.close()
    } catch (_error) {
      // ignore close errors
    }
  }
}

async function discoverToolsForServer(config: McpServerConfig): Promise<ToolSet> {
  const {
    Client,
    SSEClientTransport,
    StreamableHTTPClientTransport,
  } = await loadMcpModules()

  const validation = await validatePublicNetworkUrl(config.url, { allowLocalDev: true, requireHttps: true })
  if (!validation.ok) {
    logger.warn(`[MCP] Refusing server ${config.name}: ${validation.error}`)
    return {}
  }
  const url = validation.url
  const headers = buildAuthHeaders(config)
  const timeoutMs = config.timeoutMs ?? 30_000

  let transport: { start(): Promise<void>; close(): Promise<void>; send(message: unknown): Promise<void> } | undefined

  try {
    if (config.transport === 'sse') {
      transport = new SSEClientTransport(url, {
        requestInit: { headers },
        eventSourceInit: { headers } as EventSourceInit,
      } as import('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransportOptions)
    } else {
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers },
      } as import('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransportOptions)
    }
  } catch (err) {
    logger.warn(`[MCP] Failed to create transport for ${config.name}: ${err instanceof Error ? err.message : String(err)}`)
    return {}
  }

  const client = new Client(
    { name: 'overlay-web', version: '0.1.0' },
    { capabilities: {} }
  )

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
      await client.connect(transport as import('@modelcontextprotocol/sdk/shared/transport.js').Transport)
    } finally {
      clearTimeout(timeoutId)
    }

    const toolsResult = await client.listTools({}, { signal: AbortSignal.timeout(timeoutMs) })
    const discoveredTools = toolsResult.tools ?? []

    if (discoveredTools.length === 0) {
      return {}
    }

    const toolSet: ToolSet = {}
    const seenNames = new Set<string>()

    for (const t of discoveredTools) {
      if (!t.name) continue
      const policyDecision = resolveMcpToolPolicy(config, t.name)
      if (policyDecision === 'deny') continue

      let toolId = safeToolId(config.name, t.name)
      if (seenNames.has(toolId)) {
        let suffix = 1
        while (seenNames.has(`${toolId}_${suffix}`)) suffix++
        toolId = `${toolId}_${suffix}`
      }
      seenNames.add(toolId)

      const inputSchema = t.inputSchema as Record<string, unknown> | undefined
      const zodSchema = inputSchema
        ? jsonSchemaToZod(inputSchema)
        : z.object({})

      const descriptionParts: string[] = []
      if (t.description) descriptionParts.push(t.description)
      descriptionParts.push(`(MCP server: ${config.name})`)

      toolSet[toolId] = tool({
        description: descriptionParts.join(' '),
        inputSchema: zodSchema as z.ZodTypeAny,
        needsApproval: policyDecision === 'approval_required',
        execute: async (input) => {
          const start = Date.now()
          try {
            const result = await callMcpTool(config, t.name, input)
            await recordMcpExecution({
              args: { userId: config.userId },
              config,
              toolName: t.name,
              toolArgs: input,
              policyDecision,
              status: result.isError ? 'failed' : 'succeeded',
              durationMs: Date.now() - start,
              errorMessage: result.isError ? 'Tool returned error flag' : undefined,
            })

            // Record invocation
            void fireAndForgetRecordToolInvocation({
              userId: config.userId,
              toolName: toolId,
              mode: 'act',
              modelId: undefined,
              conversationId: undefined,
              turnId: undefined,
              success: !result.isError,
              durationMs: Date.now() - start,
              error: result.isError ? 'Tool returned error flag' : undefined,
            })

            // Flatten MCP content into a serializable result
            const content = result.content
            let resultText: string
            if (Array.isArray(content) && content.length > 0) {
              // Prefer text content
              const textParts = content
                .filter((c): c is { type: string; text?: string } =>
                  typeof c === 'object' && c !== null
                )
                .map((c) => c.text)
                .filter((t): t is string => typeof t === 'string')
              if (textParts.length > 0) {
                resultText = textParts.join('\n')
              } else {
                // Fallback: return structured content
                resultText = JSON.stringify(content)
              }
            } else {
              resultText = JSON.stringify(result)
            }
            // Truncate very large results to prevent token limit errors
            if (resultText.length > MAX_MCP_TOOL_RESULT_CHARS) {
              logger.warn(`[MCP] Truncating tool ${toolId} result from ${resultText.length} to ${MAX_MCP_TOOL_RESULT_CHARS} chars`)
              resultText = resultText.slice(0, MAX_MCP_TOOL_RESULT_CHARS) + '\n\n[Result truncated due to length]'
            }
            return resultText
          } catch (err) {
            await recordMcpExecution({
              args: { userId: config.userId },
              config,
              toolName: t.name,
              toolArgs: input,
              policyDecision,
              status: 'failed',
              durationMs: Date.now() - start,
              errorMessage: err instanceof Error ? err.message : String(err),
            }).catch((_error) => undefined)
            void fireAndForgetRecordToolInvocation({
              userId: config.userId,
              toolName: toolId,
              mode: 'act',
              modelId: undefined,
              conversationId: undefined,
              turnId: undefined,
              success: false,
              durationMs: Date.now() - start,
              error: err instanceof Error ? err.message : String(err),
            })
            throw err
          }
        },
      })
    }

    return toolSet
  } catch (err) {
    logger.warn(`[MCP] Failed to discover tools from ${config.name}: ${err instanceof Error ? err.message : String(err)}`)
    return {}
  } finally {
    try {
      await client.close()
    } catch (_error) {
      // ignore close errors
    }
  }
}

async function buildMcpToolSet(args: {
  userId: string
  accessToken?: string
  serverSecret?: string
  projectId?: string
}): Promise<ToolSet> {
  logger.info(`[MCP] Fetching enabled MCP servers for user ${args.userId}`)
  const configs = await listRuntimeMcpServers({
    userId: args.userId,
    projectId: args.projectId,
  })

  if (!configs || configs.length === 0) {
    logger.info(`[MCP] No enabled MCP servers found for user ${args.userId}`)
    return {}
  }
  logger.info(`[MCP] Found ${configs.length} enabled MCP server(s): ${configs.map(c => c.name).join(', ')}`)

  const allTools: ToolSet = {}
  const globalSeen = new Set<string>()

  for (const config of configs) {
    try {
      logger.info(`[MCP] Discovering tools from server: ${config.name} (${config.transport} ${config.url})`)
      const serverTools = await discoverToolsForServer(config)
      logger.info(`[MCP] Discovered ${Object.keys(serverTools).length} tools from server: ${config.name}`)
      for (const [id, def] of Object.entries(serverTools)) {
        if (globalSeen.has(id)) {
          // Global collision: suffix the server name
          let suffix = 1
          let newId = `${id}_${suffix}`
          while (globalSeen.has(newId)) {
            suffix++
            newId = `${id}_${suffix}`
          }
          globalSeen.add(newId)
          allTools[newId] = def
        } else {
          globalSeen.add(id)
          allTools[id] = def
        }
      }
    } catch (err) {
      logger.warn(`[MCP] Skipping server ${config.name} due to error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return allTools
}

export async function createMcpToolSet(args: {
  userId: string
  accessToken?: string
  serverSecret?: string
  projectId?: string
}): Promise<ToolSet> {
  const now = Date.now()
  const cacheKey = `${args.userId}:${args.projectId ?? 'global'}`
  const cached = mcpCache.get(cacheKey)
  if (cached && now - cached.createdAt < MCP_CACHE_TTL_MS) {
    logger.info(`[MCP] Cache hit for user ${args.userId}, returning ${Object.keys(cached.tools).length} cached tools`)
    return cached.tools
  }

  const existing = mcpInFlight.get(cacheKey)
  if (existing) {
    logger.info(`[MCP] In-flight request for user ${args.userId}, awaiting`)
    return existing
  }

  logger.info(`[MCP] Building MCP tool set for user ${args.userId}`)
  const promise = (async () => {
    try {
      const tools = await buildMcpToolSet(args)
      logger.info(`[MCP] Built ${Object.keys(tools).length} MCP tools for user ${args.userId}`)
      mcpCache.set(cacheKey, { tools, createdAt: Date.now() })
      return tools
    } finally {
      mcpInFlight.delete(cacheKey)
    }
  })()
  mcpInFlight.set(cacheKey, promise)
  return promise
}

/** Fire-and-forget pre-warm. Errors are swallowed. */
export function prewarmMcpTools(args: {
  userId: string
  accessToken?: string
  serverSecret?: string
  projectId?: string
}): void {
  const cacheKey = `${args.userId}:${args.projectId ?? 'global'}`
  const cached = mcpCache.get(cacheKey)
  if (cached && Date.now() - cached.createdAt < MCP_CACHE_TTL_MS) return
  if (mcpInFlight.has(cacheKey)) return
  void createMcpToolSet(args).catch((_error) => {
    // swallow
  })
}
