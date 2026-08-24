import { join } from 'node:path'
import { AcpAgentAdapter } from './acp-adapter'
import type { AgentAdapter } from './adapter'
import { loadAgentHostConfig } from './config'
import { diagnoseHost } from './doctor'
import { FakeAgentAdapter } from './fake-adapter'
import { StructuredLogger } from './logger'
import { AgentHostRuntime } from './runtime'
import { SqliteHostStateStore } from './state'
import { HttpAgentControlPlaneClient } from './transport'

const [command, ...args] = process.argv.slice(2)
const configPath = option(args, '--config')
if (!configPath || (command !== 'run' && command !== 'doctor')) usage()

const config = await loadAgentHostConfig(configPath)
const adapters = buildAdapters(config.adapters)

if (command === 'doctor') {
  const checks = await diagnoseHost(config, adapters)
  for (const check of checks) process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}\n`)
  if (checks.some((check) => !check.ok)) process.exitCode = 1
} else {
  if (!config.credential) throw new Error(`agent host credential is missing from ${config.credentialEnv}`)
  const logger = new StructuredLogger()
  const state = new SqliteHostStateStore(join(config.stateDirectory, 'host.sqlite'))
  const runtime = new AgentHostRuntime({
    environmentId: config.environmentId,
    workspaceId: config.workspaceId,
    filesystem: config.filesystem,
    adapters,
    state,
    controlPlane: new HttpAgentControlPlaneClient({
      baseUrl: config.controlPlaneUrl,
      environmentId: config.environmentId,
      credential: config.credential,
    }),
    logger,
  })
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort(new Error('SIGINT')))
  process.once('SIGTERM', () => controller.abort(new Error('SIGTERM')))
  logger.info('agent host started', { environmentId: config.environmentId, adapters: adapters.map((adapter) => adapter.capability.id) })
  try { await runtime.run(controller.signal) } finally { state.close() }
}

function buildAdapters(configs: AgentHostConfigAdapter[]): AgentAdapter[] {
  return configs.map((adapter) => {
    if (adapter.protocol === 'fake') return new FakeAgentAdapter()
    if (!adapter.command) throw new Error(`ACP adapter ${adapter.id} requires a command`)
    return new AcpAgentAdapter({
      id: adapter.id, displayName: adapter.displayName, command: adapter.command,
      ...(adapter.args ? { args: adapter.args } : {}), ...(adapter.env ? { env: adapter.env } : {}),
    })
  })
}

type AgentHostConfigAdapter = Awaited<ReturnType<typeof loadAgentHostConfig>>['adapters'][number]

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function usage(): never {
  process.stderr.write('Usage: overlay-agent-host <run|doctor> --config /absolute/path/config.json\n')
  process.exit(2)
}
