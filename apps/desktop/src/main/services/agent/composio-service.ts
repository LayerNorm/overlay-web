/**
 * Composio Service
 *
 * Manages Composio session creation, user/connection management, and OAuth flows.
 * Tool execution is handled via Composio meta tools (COMPOSIO_SEARCH_TOOLS, etc.)
 * passed directly to the agent — no manual action constants needed.
 */

import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import axios from 'axios'
import { Composio } from '@composio/core'
import { VercelProvider } from '@composio/vercel'
import { keyCacheService } from '../key-cache-service'

const COMPOSIO_BASE_URL = 'https://backend.composio.dev/api/v3'

let cachedComposioKey: string | null = null

// ── API Key Management ───────────────────────────────────────────────────────

/**
 * Initialize composio key cache (call after auth)
 */
export async function initComposioKey(): Promise<void> {
  console.log('[Composio] Initializing Composio API key from cache...')
  const key = await keyCacheService.getKey('composio')
  if (key) {
    const keyChanged = cachedComposioKey !== key
    cachedComposioKey = key
    console.log('[Composio] API key initialized successfully')
    void ensureToolkitPickerCatalog(keyChanged).catch((err) => {
      console.warn('[Composio] Failed to pre-load toolkit picker catalog:', err)
    })
  } else {
    cachedComposioKey = null
    pickerCatalogCache = []
    pickerCatalogFetchedAt = 0
    console.log('[Composio] No API key found in cache')
  }
}

// ── User/Connection Management ────────────────────────────────────────────────

interface ComposioConnection {
  toolkit: string
  connectedAccountId: string
  connectedAt: number
}

interface ComposioConfig {
  userId: string
  connections: ComposioConnection[]
}

export interface ComposioToolkitMetadata {
  slug: string
  name: string
  description: string
  logoUrl: string
  appUrl: string | null
}

export interface ComposioIntegrationPickerItem {
  slug: string
  name: string
  description: string
  logoUrl: string | null
  isConnected: boolean
  connectedAccountId: string | null
}

export interface ComposioIntegrationPickerResponse {
  items: ComposioIntegrationPickerItem[]
  nextCursor: string | null
}

interface PickerCursorPayloadV2 {
  v: 2
  offset: number
  query: string
}

interface PickerCatalogItem {
  slug: string
  name: string
  description: string
  logoUrl: string | null
}

function getConfigPath(): string {
  return join(app.getPath('userData'), 'composio-config.json')
}

function loadConfig(): ComposioConfig {
  const configPath = getConfigPath()
  if (existsSync(configPath)) {
    try {
      const loaded = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (loaded.entityId && !loaded.userId) {
        loaded.userId = loaded.entityId
        delete loaded.entityId
        saveConfig(loaded)
      }
      return loaded
    } catch {
      // Invalid config, create new
    }
  }
  const userId = `overlay-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
  const config: ComposioConfig = { userId, connections: [] }
  saveConfig(config)
  return config
}

function saveConfig(config: ComposioConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2))
}

let currentConfig: ComposioConfig | null = null
const PICKER_CATALOG_CACHE_TTL_MS = 15 * 60 * 1000
const PICKER_CATALOG_PAGE_SIZE = 100
const PICKER_CATALOG_MAX_PAGES = 200

let pickerCatalogCache: PickerCatalogItem[] = []
let pickerCatalogFetchedAt = 0
let pickerCatalogLoadPromise: Promise<void> | null = null

function getHeaders(): Record<string, string> | null {
  if (!cachedComposioKey) return null
  return {
    'x-api-key': cachedComposioKey,
    'Content-Type': 'application/json'
  }
}

async function getHeadersWithFallback(): Promise<Record<string, string> | null> {
  if (!cachedComposioKey) {
    cachedComposioKey = await keyCacheService.getKey('composio')
  }
  return getHeaders()
}

export function getUserId(): string {
  if (!currentConfig) currentConfig = loadConfig()
  return currentConfig.userId
}

export function isToolkitConnected(toolkit: string): boolean {
  if (!currentConfig) currentConfig = loadConfig()
  return currentConfig.connections.some((c) => c.toolkit === toolkit)
}

export function getConnectedToolkits(): string[] {
  if (!currentConfig) currentConfig = loadConfig()
  return [...new Set(currentConfig.connections.map((c) => c.toolkit.toLowerCase()))]
}

// ── Composio Session & Meta Tools ─────────────────────────────────────────────

/**
 * Create a Composio session for the current user.
 * Uses VercelProvider so meta tools are returned in AI SDK format.
 * Create one session per agent run.
 */
export async function createComposioSession(): Promise<
  Awaited<ReturnType<InstanceType<typeof Composio>['create']>>
> {
  const apiKey = cachedComposioKey || (await keyCacheService.getKey('composio'))
  if (!apiKey) {
    throw new Error('Composio API key not available. Please sign in first.')
  }
  const composio = new Composio({ apiKey, provider: new VercelProvider() })
  const userId = getUserId()
  const session = await composio.create(userId)
  return session
}

/**
 * Get the Composio meta tools for the current user session, formatted for
 * the Vercel AI SDK. Includes:
 *   - COMPOSIO_SEARCH_TOOLS: discover relevant tools across 1000+ toolkits
 *   - COMPOSIO_MANAGE_CONNECTIONS: authenticate a toolkit in-chat
 *   - COMPOSIO_MULTI_EXECUTE_TOOL: execute multiple discovered tools
 *   - COMPOSIO_REMOTE_WORKBENCH / COMPOSIO_REMOTE_BASH_TOOL: remote execution
 */
export async function getComposioMetaTools(): Promise<Record<string, unknown>> {
  try {
    const session = await createComposioSession()
    const tools = await session.tools()
    console.log(`[Composio] Meta tools loaded: ${Object.keys(tools as object).join(', ')}`)
    return tools as Record<string, unknown>
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Composio] Failed to load meta tools: ${msg}`)
    return {}
  }
}

const toolkitMetadataCache = new Map<string, ComposioToolkitMetadata>()

function normalizeToolkitSlug(slug: string): string {
  return slug.trim().toLowerCase()
}

function hasScheme(schemes: string[], pattern: RegExp): boolean {
  return schemes.some((scheme) => pattern.test(scheme.toLowerCase()))
}

function supportsOauthWithoutApiKey(
  authSchemes: string[],
  composioManagedAuthSchemes: string[]
): boolean {
  const allSchemes = [...authSchemes, ...composioManagedAuthSchemes].map((scheme) =>
    scheme.toLowerCase()
  )
  const oauthPattern = /oauth/
  const apiKeyPattern = /api[\s_-]?key/
  return hasScheme(allSchemes, oauthPattern) && !hasScheme(allSchemes, apiKeyPattern)
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/[\s_-]+/g, '')
}

function matchesToolkitQuery(toolkit: { slug: string }, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return true

  const slug = normalizeToolkitSlug(toolkit.slug)
  const slugWords = slug.replace(/[_-]/g, ' ')
  const haystack = `${slug} ${slugWords}`

  const compactQuery = compactSearchText(normalizedQuery)
  const compactHaystack = compactSearchText(slug)
  if (compactQuery && compactHaystack.includes(compactQuery)) {
    return true
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean)
  return queryTokens.every((token) => haystack.includes(token))
}

function parsePickerCursorOffset(cursor: string | undefined, query: string): number {
  if (!cursor) return 0

  const tryDecode = (encoding: BufferEncoding): PickerCursorPayloadV2 | null => {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, encoding).toString('utf8')
      ) as PickerCursorPayloadV2
      if (decoded?.v !== 2 || decoded.query !== query) return null
      if (!Number.isFinite(decoded.offset) || decoded.offset < 0) return null
      return decoded
    } catch {
      return null
    }
  }

  const decoded = tryDecode('base64url') || tryDecode('base64')
  if (decoded) return Math.floor(decoded.offset)

  const numericOffset = Number(cursor)
  if (Number.isFinite(numericOffset) && numericOffset >= 0) {
    return Math.floor(numericOffset)
  }

  return 0
}

function encodePickerCursorOffset(offset: number, query: string, totalItems: number): string | null {
  if (offset >= totalItems) return null

  const payload: PickerCursorPayloadV2 = {
    v: 2,
    offset: Math.max(0, Math.floor(offset)),
    query
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

async function loadToolkitPickerCatalog(headers: Record<string, string>): Promise<PickerCatalogItem[]> {
  let pagesFetched = 0
  let rawItemsScanned = 0
  let rawCursor: string | null = null
  const deduped = new Map<string, PickerCatalogItem>()

  while (pagesFetched < PICKER_CATALOG_MAX_PAGES) {
    const response = await axios.get(`${COMPOSIO_BASE_URL}/toolkits`, {
      headers,
      params: {
        cursor: rawCursor || undefined,
        limit: PICKER_CATALOG_PAGE_SIZE,
        include_deprecated: false,
        sort_by: 'alphabetically',
        managed_by: 'all'
      }
    })

    const toolkits = (response.data?.items || []) as Array<{
      slug?: string
      name?: string
      auth_schemes?: string[]
      composio_managed_auth_schemes?: string[]
      meta?: {
        description?: string
        logo?: string
      }
    }>

    pagesFetched += 1
    rawItemsScanned += toolkits.length
    rawCursor = response.data?.next_cursor || null

    for (const toolkit of toolkits) {
      const slug = normalizeToolkitSlug(toolkit.slug || '')
      if (!slug) continue
      if (
        !supportsOauthWithoutApiKey(
          toolkit.auth_schemes || [],
          toolkit.composio_managed_auth_schemes || []
        )
      ) {
        continue
      }

      deduped.set(slug, {
        slug,
        name: toolkit.name || toolkit.slug || '',
        description: toolkit.meta?.description || '',
        logoUrl: toolkit.meta?.logo || null
      })
    }

    if (!rawCursor) break
  }

  const catalog = [...deduped.values()].sort((a, b) => a.slug.localeCompare(b.slug))
  console.log(
    `[Composio] Toolkit picker catalog loaded: items=${catalog.length} pagesFetched=${pagesFetched} rawItemsScanned=${rawItemsScanned}`
  )
  return catalog
}

async function ensureToolkitPickerCatalog(force = false): Promise<void> {
  const headers = await getHeadersWithFallback()
  if (!headers) {
    pickerCatalogCache = []
    pickerCatalogFetchedAt = 0
    return
  }

  const cacheIsFresh =
    !force &&
    pickerCatalogCache.length > 0 &&
    Date.now() - pickerCatalogFetchedAt < PICKER_CATALOG_CACHE_TTL_MS
  if (cacheIsFresh) return

  if (pickerCatalogLoadPromise) {
    await pickerCatalogLoadPromise
    return
  }

  pickerCatalogLoadPromise = (async () => {
    try {
      const loaded = await loadToolkitPickerCatalog(headers)
      pickerCatalogCache = loaded
      pickerCatalogFetchedAt = Date.now()
    } catch (error) {
      if (pickerCatalogCache.length > 0) {
        console.warn('[Composio] Failed to refresh picker catalog, using stale cache:', error)
        return
      }
      throw error
    }
  })()

  try {
    await pickerCatalogLoadPromise
  } finally {
    pickerCatalogLoadPromise = null
  }
}

async function fetchToolkitMetadataBySlug(
  headers: Record<string, string>,
  slug: string
): Promise<ComposioToolkitMetadata | null> {
  const response = await axios.get(`${COMPOSIO_BASE_URL}/toolkits`, {
    headers,
    params: {
      search: slug,
      limit: 100,
      include_deprecated: false
    }
  })

  const items = (response.data?.items || []) as Array<{
    slug?: string
    name?: string
    meta?: {
      description?: string
      logo?: string
      app_url?: string | null
    }
  }>

  if (items.length === 0) return null

  const exact = items.find((item) => normalizeToolkitSlug(item.slug || '') === slug)
  const match = exact || items[0]
  if (!match?.slug) return null

  return {
    slug: normalizeToolkitSlug(match.slug),
    name: match.name || match.slug,
    description: match.meta?.description || '',
    logoUrl: match.meta?.logo || '',
    appUrl: match.meta?.app_url || null
  }
}

export async function getToolkitMetadata(
  toolkits: string[]
): Promise<Record<string, ComposioToolkitMetadata>> {
  const normalizedToolkits = [...new Set(toolkits.map(normalizeToolkitSlug).filter(Boolean))]
  if (normalizedToolkits.length === 0) return {}

  const result: Record<string, ComposioToolkitMetadata> = {}
  const missing: string[] = []

  for (const toolkit of normalizedToolkits) {
    const cached = toolkitMetadataCache.get(toolkit)
    if (cached) {
      result[toolkit] = cached
    } else {
      missing.push(toolkit)
    }
  }

  if (missing.length === 0) return result

  const headers = await getHeadersWithFallback()
  if (!headers) return result

  await Promise.all(
    missing.map(async (toolkit) => {
      try {
        const metadata = await fetchToolkitMetadataBySlug(headers, toolkit)
        if (!metadata) return

        toolkitMetadataCache.set(toolkit, metadata)
        toolkitMetadataCache.set(metadata.slug, metadata)
        result[toolkit] = metadata
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[Composio] Failed to fetch toolkit metadata for "${toolkit}": ${msg}`)
      }
    })
  )

  return result
}

export async function listToolkitPickerItems(params: {
  query?: string
  cursor?: string
  limit?: number
}): Promise<ComposioIntegrationPickerResponse> {
  await ensureToolkitPickerCatalog()
  const limit = Math.min(Math.max(params.limit ?? 40, 1), 100)
  const query = normalizeSearchText(params.query || '')
  const offset = parsePickerCursorOffset(params.cursor, query)

  const connectedToolkits = getConnectedToolkits()
  const connectedByToolkit = new Map<string, string>()
  if (!currentConfig) currentConfig = loadConfig()
  for (const connection of currentConfig.connections) {
    const slug = normalizeToolkitSlug(connection.toolkit)
    if (!slug) continue
    connectedByToolkit.set(slug, connection.connectedAccountId)
  }

  const filteredCatalog = pickerCatalogCache.filter((item) => matchesToolkitQuery(item, query))
  const pagedItems = filteredCatalog.slice(offset, offset + limit).map((item) => ({
    ...item,
    isConnected: connectedToolkits.includes(item.slug),
    connectedAccountId: connectedByToolkit.get(item.slug) || null
  }))
  const nextCursor = encodePickerCursorOffset(offset + pagedItems.length, query, filteredCatalog.length)

  console.log(
    `[Composio] listToolkitPickerItems query="${query}" cursor=${params.cursor || 'null'} offset=${offset} returned=${pagedItems.length} totalFiltered=${filteredCatalog.length} catalogSize=${pickerCatalogCache.length} activeConnections=${connectedByToolkit.size} nextCursor=${nextCursor || 'null'}`
  )

  return { items: pagedItems, nextCursor }
}

/**
 * Sync connected toolkits from the Composio API into local config.
 * Call after an agent run to pick up any toolkits authenticated in-chat.
 */
export async function syncConnectedToolkits(): Promise<string[]> {
  const headers = getHeaders()
  if (!headers) return getConnectedToolkits()

  try {
    const userId = getUserId()
    const response = await axios.get(`${COMPOSIO_BASE_URL}/connected_accounts`, {
      headers,
      params: { user_id: userId, status: 'ACTIVE' }
    })

    const connections = (response.data?.items || []) as Array<{
      id: string
      toolkit?: { slug?: string }
      status: string
    }>

    if (!currentConfig) currentConfig = loadConfig()

    const previousConnections = currentConfig.connections
    const previousByToolkit = new Map(
      previousConnections.map((c) => [c.toolkit.toLowerCase(), c] as const)
    )

    const activeConnections: ComposioConnection[] = connections
      .filter((conn) => conn.status === 'ACTIVE')
      .map((conn) => {
        const toolkit = (conn.toolkit?.slug || '').trim().toLowerCase()
        if (!toolkit) return null
        const previous = previousByToolkit.get(toolkit)
        return {
          toolkit,
          connectedAccountId: conn.id,
          connectedAt: previous?.connectedAt ?? Date.now()
        }
      })
      .filter((conn): conn is ComposioConnection => conn !== null)

    const prevSet = new Set(previousConnections.map((c) => c.toolkit.toLowerCase()))
    const nextSet = new Set(activeConnections.map((c) => c.toolkit.toLowerCase()))

    const added = [...nextSet].filter((toolkit) => !prevSet.has(toolkit))
    const removed = [...prevSet].filter((toolkit) => !nextSet.has(toolkit))

    const changed =
      added.length > 0 ||
      removed.length > 0 ||
      previousConnections.length !== activeConnections.length ||
      previousConnections.some((c) => {
        const next = activeConnections.find((n) => n.toolkit === c.toolkit.toLowerCase())
        return !next || next.connectedAccountId !== c.connectedAccountId
      })

    currentConfig.connections = activeConnections

    if (changed) saveConfig(currentConfig)
    for (const toolkit of added) {
      console.log(`[Composio] Synced new connection: ${toolkit}`)
    }
    for (const toolkit of removed) {
      console.log(`[Composio] Removed stale connection: ${toolkit}`)
    }

    return getConnectedToolkits()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Composio] syncConnectedToolkits failed: ${msg}`)
    return getConnectedToolkits()
  }
}

// ── OAuth Flow Management ─────────────────────────────────────────────────────

export async function initiateOAuthFlow(
  toolkit: string
): Promise<{ redirectUrl: string; connectionId: string; alreadyConnected?: boolean }> {
  const apiKey = cachedComposioKey || (await keyCacheService.getKey('composio'))
  if (!apiKey) {
    throw new Error('Composio API key not available. Please sign in first.')
  }
  cachedComposioKey = apiKey

  const userId = getUserId()
  const normalizedToolkit = normalizeToolkitSlug(toolkit)
  console.log(
    `[Composio] initiateOAuthFlow start toolkit="${normalizedToolkit}" userId="${userId}"`
  )

  const alreadyConnected = await checkConnectionStatus(normalizedToolkit)
  if (alreadyConnected) {
    console.log(`[Composio] initiateOAuthFlow toolkit="${normalizedToolkit}" already connected`)
    return { redirectUrl: '', connectionId: '', alreadyConnected: true }
  }

  try {
    const session = await createComposioSession()
    const connectionRequest = await session.authorize(normalizedToolkit)
    const redirectUrl =
      typeof connectionRequest.redirectUrl === 'string' ? connectionRequest.redirectUrl : ''
    const connectionId = typeof connectionRequest.id === 'string' ? connectionRequest.id : ''

    console.log(
      `[Composio] initiateOAuthFlow session.authorize success toolkit="${normalizedToolkit}" connectionId="${connectionId}" hasRedirect=${Boolean(redirectUrl)}`
    )

    if (redirectUrl || connectionId) {
      return {
        redirectUrl,
        connectionId
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[Composio] initiateOAuthFlow session.authorize failed toolkit="${normalizedToolkit}" error=${message}`
    )
  }

  let fallbackError: unknown = null
  try {
    const composio = new Composio({ apiKey })
    const connectionRequest = await composio.toolkits.authorize(userId, normalizedToolkit)
    const redirectUrl =
      typeof connectionRequest.redirectUrl === 'string' ? connectionRequest.redirectUrl : ''
    const connectionId = typeof connectionRequest.id === 'string' ? connectionRequest.id : ''

    console.log(
      `[Composio] initiateOAuthFlow toolkits.authorize success toolkit="${normalizedToolkit}" connectionId="${connectionId}" hasRedirect=${Boolean(redirectUrl)}`
    )

    if (redirectUrl || connectionId) {
      return {
        redirectUrl,
        connectionId
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[Composio] initiateOAuthFlow toolkits.authorize failed toolkit="${normalizedToolkit}" error=${message}`
    )
    fallbackError = error
  }

  const connectedAfterAuthorize = await checkConnectionStatus(normalizedToolkit)
  if (connectedAfterAuthorize) {
    return { redirectUrl: '', connectionId: '', alreadyConnected: true }
  }

  if (fallbackError) {
    throw fallbackError
  }

  throw new Error(`Failed to start OAuth flow for "${normalizedToolkit}"`)
}

export async function checkConnectionStatus(toolkit: string): Promise<boolean> {
  const headers = await getHeadersWithFallback()
  if (!headers) {
    console.log('[Composio] API key not available, cannot check connection status')
    return false
  }

  const userId = getUserId()
  const normalizedToolkit = normalizeToolkitSlug(toolkit)

  try {
    console.log(
      `[Composio] checkConnectionStatus start toolkit="${normalizedToolkit}" userId="${userId}"`
    )
    const response = await axios.get(`${COMPOSIO_BASE_URL}/connected_accounts`, {
      headers,
      params: { user_id: userId }
    })

    const connections = response.data?.items || []
    const activeConnection = connections.find(
      (conn: { toolkit?: { slug?: string }; status: string; id: string }) =>
        normalizeToolkitSlug(conn.toolkit?.slug || '') === normalizedToolkit &&
        conn.status === 'ACTIVE'
    )

    if (activeConnection && !isToolkitConnected(normalizedToolkit)) {
      if (!currentConfig) currentConfig = loadConfig()
      currentConfig.connections.push({
        toolkit: normalizedToolkit,
        connectedAccountId: activeConnection.id,
        connectedAt: Date.now()
      })
      saveConfig(currentConfig)
    }

    const isConnected = Boolean(activeConnection)
    console.log(
      `[Composio] checkConnectionStatus result toolkit="${normalizedToolkit}" isConnected=${isConnected}`
    )
    return isConnected
  } catch (error) {
    console.error(`[Composio] Failed to check connection status:`, error)
    return false
  }
}

export async function disconnectToolkit(toolkit: string): Promise<boolean> {
  if (!currentConfig) currentConfig = loadConfig()
  currentConfig.connections = currentConfig.connections.filter((c) => c.toolkit !== toolkit)
  saveConfig(currentConfig)
  return true
}
