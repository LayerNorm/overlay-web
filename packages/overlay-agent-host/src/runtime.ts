import { setTimeout as wait } from 'node:timers/promises'
import { filesystemGrantSchema, type FilesystemGrant } from '@layernorm/overlay-agent-bridge-protocol'
import { buildHostCapabilities } from './host-capabilities.js'
import { HostHeartbeat } from './host-heartbeat.js'
import { LocalToolLoop, type LocalToolExecutor } from './local-tools.js'
import { StructuredLogger } from './logger.js'
import type { AgentControlPlaneClient } from './transport.js'

export type AgentHostRuntimeOptions = {
  environmentId: string
  workspaceId: string
  filesystem: FilesystemGrant
  controlPlane: AgentControlPlaneClient
  localTools: LocalToolExecutor
  logger?: StructuredLogger
}

const CAPABILITY_REFRESH_MS = 24 * 60 * 60_000

/**
 * The host's whole job: keep this machine's environment online, advertise its
 * local tools, and answer Overlay's tool calls. It starts no agent harness.
 */
export class AgentHostRuntime {
  private readonly logger: StructuredLogger
  private readonly heartbeat: HostHeartbeat

  constructor(private readonly options: AgentHostRuntimeOptions) {
    this.logger = options.logger ?? new StructuredLogger()
    this.heartbeat = new HostHeartbeat(() => options.controlPlane.heartbeat())
  }

  updateFilesystemGrant(grant: FilesystemGrant): void {
    this.options.filesystem = filesystemGrantSchema.parse(grant)
  }

  get filesystem(): FilesystemGrant { return this.options.filesystem }

  async refreshCapabilities(): Promise<void> {
    await this.options.controlPlane.updateCapabilities(buildHostCapabilities({
      filesystem: this.options.filesystem, localTools: await this.options.localTools.capability(),
    }))
  }

  async run(signal: AbortSignal): Promise<void> {
    await this.retryUntilAborted(signal, async () => { await this.refreshCapabilities(); await this.heartbeat.send() }, 'host registration deferred')
    if (signal.aborted) return
    this.heartbeat.start(signal, error => this.logger.warn('host heartbeat deferred', { error: safeError(error) }))
    const refresh = setInterval(() => void this.refreshCapabilities().catch(error =>
      this.logger.warn('capability refresh deferred', { error: safeError(error) })), CAPABILITY_REFRESH_MS)
    refresh.unref?.()
    this.logger.info('local tools ready', { environmentId: this.options.environmentId })
    try {
      await new LocalToolLoop(this.options.controlPlane, this.options.localTools, this.logger).run(signal)
    } finally {
      clearInterval(refresh)
      await this.heartbeat.stop()
    }
  }

  private async retryUntilAborted(signal: AbortSignal, work: () => Promise<void>, message: string): Promise<void> {
    for (let attempt = 0; !signal.aborted; attempt++) {
      try { await work(); return } catch (error) {
        const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6))
        this.logger.warn(message, { error: safeError(error), delay })
        await wait(delay, undefined, { signal }).catch(() => undefined)
      }
    }
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
}
