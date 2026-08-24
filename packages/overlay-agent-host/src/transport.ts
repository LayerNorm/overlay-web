import {
  commandPollResponseSchema,
  eventAcknowledgementSchema,
  eventBatchSchema,
  OVERLAY_AGENT_PROTOCOL_VERSION,
  type AgentHostCommand,
  type CommandAcknowledgement,
  type EventAcknowledgement,
  type EventBatch,
} from '@overlay/agent-bridge-protocol'

export interface AgentControlPlaneClient {
  pollCommands(args: { waitMs: number; signal?: AbortSignal }): Promise<{ commands: AgentHostCommand[]; retryAfterMs?: number }>
  acknowledgeCommand(acknowledgement: CommandAcknowledgement): Promise<void>
  uploadEvents(batch: EventBatch): Promise<EventAcknowledgement>
}

export type HttpControlPlaneClientOptions = {
  baseUrl: string
  environmentId: string
  credential: string
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
}

export class HttpAgentControlPlaneClient implements AgentControlPlaneClient {
  private readonly fetch: typeof globalThis.fetch
  private readonly requestTimeoutMs: number

  constructor(private readonly options: HttpControlPlaneClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.requestTimeoutMs = options.requestTimeoutMs ?? 35_000
  }

  async pollCommands(args: { waitMs: number; signal?: AbortSignal }): Promise<{ commands: AgentHostCommand[]; retryAfterMs?: number }> {
    const url = new URL('commands', withSlash(this.options.baseUrl))
    url.searchParams.set('environmentId', this.options.environmentId)
    url.searchParams.set('waitMs', String(Math.min(Math.max(args.waitMs, 0), 30_000)))
    const response = await this.request(url, { method: 'GET', signal: args.signal })
    const parsed = commandPollResponseSchema.parse(await response.json())
    return { commands: parsed.commands, ...(parsed.retryAfterMs === undefined ? {} : { retryAfterMs: parsed.retryAfterMs }) }
  }

  async acknowledgeCommand(acknowledgement: CommandAcknowledgement): Promise<void> {
    await this.request(new URL(`commands/${encodeURIComponent(acknowledgement.commandId)}/ack`, withSlash(this.options.baseUrl)), {
      method: 'POST', body: JSON.stringify(acknowledgement), headers: { 'content-type': 'application/json' },
    })
  }

  async uploadEvents(batch: EventBatch): Promise<EventAcknowledgement> {
    const validated = eventBatchSchema.parse(batch)
    const response = await this.request(new URL('events', withSlash(this.options.baseUrl)), {
      method: 'POST', body: JSON.stringify(validated), headers: { 'content-type': 'application/json' },
    })
    return eventAcknowledgementSchema.parse(await response.json())
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs)
    const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout
    const response = await this.fetch(url, {
      ...init,
      signal,
      headers: { authorization: `Bearer ${this.options.credential}`, 'x-overlay-protocol-version': String(OVERLAY_AGENT_PROTOCOL_VERSION), ...init.headers },
    })
    if (!response.ok) throw new Error(`control plane request failed with ${response.status}`)
    return response
  }
}

function withSlash(value: string): string { return value.endsWith('/') ? value : `${value}/` }

export function nextReconnectDelay(attempt: number, random = Math.random): number {
  const capped = Math.min(Math.max(attempt, 0), 8)
  const ceiling = Math.min(30_000, 250 * (2 ** capped))
  return Math.max(100, Math.floor(ceiling * (0.5 + random() * 0.5)))
}
