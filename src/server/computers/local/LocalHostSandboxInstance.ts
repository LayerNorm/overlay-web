import 'server-only'

import type { LocalDriverCommand, LocalExecResult, LocalListFilesResult, LocalReadFileResult, LocalToolRequest } from '@layernorm/overlay-agent-bridge-protocol'
import type {
  SandboxCapabilities,
  SandboxCommandHandle,
  SandboxCommandRequest,
  SandboxFileEntry,
  SandboxInstance,
} from '@overlay/sandbox-runtime'
import type { LocalComputer, LocalComputerService } from './LocalComputerService'

const READ_MAX_BYTES = 512 * 1024
const DRIVER_ACTION_TIMEOUT_MS = 45_000

function unsupported(operation: string): never {
  throw new Error(`${operation} is not available on a local computer`)
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/**
 * The user's Mac presented through the sandbox interface the Computer tools
 * already use, so every tool runs unchanged. Desktop commands go straight to
 * the host's native driver instead of the cloud machine's Python driver.
 */
export class LocalHostSandboxInstance implements SandboxInstance {
  readonly provider = 'local' as unknown as SandboxInstance['provider']
  readonly reference: string
  readonly name: string
  readonly capabilities: SandboxCapabilities

  constructor(
    readonly computer: LocalComputer,
    private readonly service: Pick<LocalComputerService, 'execute'>,
    private readonly actor: { userId: string; agentId?: string; toolName: string },
  ) {
    this.reference = computer.environmentId
    this.name = computer.name
    const features = new Set(computer.capability.features)
    this.capabilities = {
      commandStreaming: false, files: features.has('files'), environmentVariables: false, ports: false, snapshots: false,
      persistence: true, networkPolicy: false, networkPolicyUpdates: false, credentialBrokering: false, hardTimeout: true,
      idleStop: false, usage: false, desktop: features.has('screenshot') || features.has('input') || features.has('browser'),
    }
  }

  get homeDirectory(): string { return this.computer.capability.homeDirectory }

  private send(request: LocalToolRequest, actionTimeoutMs: number) {
    return this.service.execute({
      computer: this.computer, userId: this.actor.userId, ...(this.actor.agentId ? { agentId: this.actor.agentId } : {}),
      toolName: this.actor.toolName, request, actionTimeoutMs,
    })
  }

  /** A desktop or terminal command on the Mac's native driver. */
  async driver(command: LocalDriverCommand, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await this.send({ kind: 'driver', command, args }, DRIVER_ACTION_TIMEOUT_MS)
  }

  async status() { return 'running' as const }
  async workingDirectory() { return this.computer.capability.homeDirectory }
  async resume() {}
  async stop() {}
  async delete() { unsupported('delete') }

  async runCommand(request: SandboxCommandRequest): Promise<SandboxCommandHandle> {
    // Gateway credentials minted for cloud machines are not forwarded to the user's own computer.
    const command = [request.command, ...(request.args ?? []).map(quote)].join(' ')
    const timeoutMs = Math.min(Math.max(request.timeoutMs, 1_000), 300_000)
    const result = await this.send({ kind: 'exec', command, ...(request.cwd ? { cwd: request.cwd } : {}), timeoutMs }, timeoutMs) as unknown as LocalExecResult
    return {
      id: `local-${result.startedAt}`,
      async *events() {},
      wait: async () => ({ commandId: `local-${result.startedAt}`, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, startedAt: result.startedAt, endedAt: result.endedAt }),
      cancel: async () => {},
    }
  }

  async writeFiles(files: Array<{ path: string; contents: Uint8Array }>): Promise<void> {
    for (const file of files) {
      await this.send({ kind: 'write_file', path: file.path, contentsBase64: Buffer.from(file.contents).toString('base64') }, 30_000)
    }
  }

  async readFile(path: string): Promise<Uint8Array | null> {
    const result = await this.send({ kind: 'read_file', path, maxBytes: READ_MAX_BYTES }, 30_000) as unknown as LocalReadFileResult
    return result.found ? new Uint8Array(Buffer.from(result.contentsBase64, 'base64')) : null
  }

  async listFiles(path: string): Promise<SandboxFileEntry[]> {
    const result = await this.send({ kind: 'list_files', path }, 30_000) as unknown as LocalListFilesResult
    return result.entries
  }

  async updateEnvironment() { unsupported('updateEnvironment') }
  async updateNetworkPolicy() { unsupported('updateNetworkPolicy') }
  async port(): Promise<never> { unsupported('port') }
  async snapshot(): Promise<never> { unsupported('snapshot') }
  async usage() { return {} }
  rawProviderDiagnosticHandle() { return null }
}

export function isLocalHostSandboxInstance(instance: unknown): instance is LocalHostSandboxInstance {
  return instance instanceof LocalHostSandboxInstance
}
