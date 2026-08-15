import 'server-only'

import { logger } from '@/server/observability/logger'
import { getServerProviderKey } from '@/server/ai/gateway/server-provider-keys'

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3.1'

interface ComposioExecuteResponse<T = unknown> {
  data?: T | string
  successful?: boolean
  error?: string
  log_id?: string
}

interface SlackChannel {
  id: string
  name?: string
  is_channel?: boolean
  is_group?: boolean
  is_im?: boolean
  is_mpim?: boolean
  is_private?: boolean
  num_members?: number
  created?: number
  /** For `im` channels: the other participant's Slack user id. */
  user?: string
}

interface SlackMessage {
  ts: string
  user?: string
  username?: string
  text?: string
  type?: string
  thread_ts?: string
  reply_count?: number
  latest_reply?: string
  files?: Array<{
    id: string
    name?: string
    mimetype?: string
    filetype?: string
    size?: number
    url_private?: string
  }>
  reactions?: Array<{
    name: string
    users?: string[]
    count?: number
  }>
  edited?: { ts: string; user: string }
  subtype?: string
}

interface SlackUser {
  id: string
  name?: string
  real_name?: string
  profile?: {
    email?: string
    display_name?: string
    image_24?: string
    image_48?: string
    image_72?: string
  }
  is_bot?: boolean
  deleted?: boolean
}

interface PaginatedResult<T> {
  items: T[]
  nextCursor: string | null
}

/**
 * Thin REST client for Composio's Slackbot toolkit.
 * Calls the direct tool execution endpoint — no LLM session involved.
 * Composio handles OAuth token management; we just pass the connected_account_id.
 */
export class ComposioSlackClient {
  private apiKey: string | null = null
  private apiKeyPromise: Promise<string | null> | null = null

  private async getApiKey(): Promise<string | null> {
    if (this.apiKey) return this.apiKey
    if (!this.apiKeyPromise) {
      this.apiKeyPromise = getServerProviderKey('composio')
      this.apiKey = await this.apiKeyPromise
      this.apiKeyPromise = null
    }
    return this.apiKey
  }

  private async executeTool<T = unknown>(
    toolSlug: string,
    args: Record<string, unknown>,
    connectedAccountId: string,
    entityId: string,
  ): Promise<T> {
    const apiKey = await this.getApiKey()
    if (!apiKey) {
      throw new Error('COMPOSIO_API_KEY is not configured')
    }

    const res = await fetch(`${COMPOSIO_API_BASE}/tools/execute/${toolSlug}`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connected_account_id: connectedAccountId,
        entity_id: entityId,
        arguments: args,
      }),
    })

    const body = await res.json() as ComposioExecuteResponse<T>

    if (!res.ok || body.successful === false) {
      const rawError = body.error
      const errorMsg = typeof rawError === 'string'
        ? rawError
        : typeof rawError === 'object' && rawError !== null
          ? JSON.stringify(rawError).substring(0, 500)
          : `Composio tool ${toolSlug} failed (HTTP ${res.status})`
      logger.error(`[ComposioSlack] ${toolSlug} failed:`, errorMsg)
      throw new Error(errorMsg)
    }

    // Composio wraps the Slack API response in a `data` field, sometimes as a JSON string
    const data = body.data
    if (typeof data === 'string') {
      return JSON.parse(data) as T
    }
    return (data ?? body) as T
  }

  /**
   * List all channels the connected user can see (public, private, DMs, MPIMs).
   */
  async listChannels(
    connectedAccountId: string,
    entityId: string,
    options?: { types?: string; limit?: number; cursor?: string },
  ): Promise<PaginatedResult<SlackChannel>> {
    const result = await this.executeTool<{
      channels?: SlackChannel[]
      response_metadata?: { next_cursor?: string }
    }>('SLACKBOT_LIST_ALL_CHANNELS', {
      limit: options?.limit ?? 200,
      types: options?.types ?? 'public_channel,private_channel,mpim,im',
      ...(options?.cursor ? { cursor: options.cursor } : {}),
    }, connectedAccountId, entityId)

    return {
      items: result.channels ?? [],
      nextCursor: result.response_metadata?.next_cursor || null,
    }
  }

  /**
   * List all channels by paginating until exhausted.
   */
  async listAllChannels(
    connectedAccountId: string,
    entityId: string,
    options?: { types?: string },
  ): Promise<SlackChannel[]> {
    const all: SlackChannel[] = []
    let cursor: string | undefined
    do {
      const page = await this.listChannels(connectedAccountId, entityId, {
        ...(options?.types ? { types: options.types } : {}),
        cursor,
      })
      all.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return all
  }

  /**
   * List all users in the workspace.
   */
  async listUsers(
    connectedAccountId: string,
    entityId: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<PaginatedResult<SlackUser>> {
    const result = await this.executeTool<{
      members?: SlackUser[]
      response_metadata?: { next_cursor?: string }
    }>('SLACKBOT_LIST_ALL_USERS', {
      limit: options?.limit ?? 200,
      ...(options?.cursor ? { cursor: options.cursor } : {}),
    }, connectedAccountId, entityId)

    return {
      items: result.members ?? [],
      nextCursor: result.response_metadata?.next_cursor || null,
    }
  }

  /**
   * List all users by paginating until exhausted.
   */
  async listAllUsers(connectedAccountId: string, entityId: string): Promise<SlackUser[]> {
    const all: SlackUser[] = []
    let cursor: string | undefined
    do {
      const page = await this.listUsers(connectedAccountId, entityId, { cursor })
      all.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return all
  }

  /**
   * Fetch a page of messages from a channel.
   */
  async fetchHistory(
    connectedAccountId: string,
    entityId: string,
    channelId: string,
    options?: { limit?: number; cursor?: string; oldest?: string; latest?: string },
  ): Promise<PaginatedResult<SlackMessage>> {
    const result = await this.executeTool<{
      messages?: SlackMessage[]
      has_more?: boolean
      response_metadata?: { next_cursor?: string }
    }>('SLACKBOT_FETCH_CONVERSATION_HISTORY', {
      channel: channelId,
      limit: options?.limit ?? 100,
      ...(options?.cursor ? { cursor: options.cursor } : {}),
      ...(options?.oldest ? { oldest: options.oldest } : {}),
      ...(options?.latest ? { latest: options.latest } : {}),
    }, connectedAccountId, entityId)

    return {
      items: result.messages ?? [],
      nextCursor: result.response_metadata?.next_cursor || null,
    }
  }

  /**
   * Fetch all messages from a channel by paginating until exhausted.
   * Calls onProgress after each page so the worker can checkpoint.
   */
  async fetchAllHistory(
    connectedAccountId: string,
    entityId: string,
    channelId: string,
    onProgress?: (messages: SlackMessage[], totalSoFar: number) => Promise<void>,
  ): Promise<SlackMessage[]> {
    const all: SlackMessage[] = []
    let cursor: string | undefined
    do {
      const page = await this.fetchHistory(connectedAccountId, entityId, channelId, { cursor })
      all.push(...page.items)
      if (onProgress) await onProgress(page.items, all.length)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return all
  }

  /**
   * Fetch thread replies for a parent message.
   */
  async fetchThread(
    connectedAccountId: string,
    entityId: string,
    channelId: string,
    threadTs: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<PaginatedResult<SlackMessage>> {
    const result = await this.executeTool<{
      messages?: SlackMessage[]
      has_more?: boolean
      response_metadata?: { next_cursor?: string }
    }>('SLACKBOT_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION', {
      channel: channelId,
      ts: threadTs,
      limit: options?.limit ?? 100,
      ...(options?.cursor ? { cursor: options.cursor } : {}),
    }, connectedAccountId, entityId)

    return {
      items: result.messages ?? [],
      nextCursor: result.response_metadata?.next_cursor || null,
    }
  }

  /**
   * Fetch all thread replies by paginating until exhausted.
   * The first message in the response is the parent message.
   */
  async fetchAllThread(
    connectedAccountId: string,
    entityId: string,
    channelId: string,
    threadTs: string,
  ): Promise<SlackMessage[]> {
    const all: SlackMessage[] = []
    let cursor: string | undefined
    do {
      const page = await this.fetchThread(connectedAccountId, entityId, channelId, threadTs, { cursor })
      all.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return all
  }

  /**
   * Download a Slack file. Returns a public URL (Composio converts the file
   * to a publicly accessible URL).
   */
  async downloadFile(
    connectedAccountId: string,
    entityId: string,
    fileId: string,
  ): Promise<{ url: string; filename?: string }> {
    const result = await this.executeTool<{
      url?: string
      public_url?: string
      name?: string
      filename?: string
    }>('SLACKBOT_DOWNLOAD_FILE', {
      file: fileId,
    }, connectedAccountId, entityId)

    const url = result.url || result.public_url
    if (!url) {
      throw new Error(`Failed to download Slack file ${fileId}: no URL returned`)
    }
    return { url, filename: result.name || result.filename }
  }
}

export type {
  SlackChannel,
  SlackMessage,
  SlackUser,
  PaginatedResult,
}
