import { join } from 'node:path'
import { homedir } from 'node:os'
import { AcpAgentAdapter } from './acp-adapter'
import type { AgentAdapter } from './adapter'
import { loadAgentHostConfig } from './config'
import { diagnoseHost } from './doctor'
import { FakeAgentAdapter } from './fake-adapter'
import { StructuredLogger } from './logger'
import { AgentHostRuntime } from './runtime'
import { SqliteHostStateStore } from './state'
import { HttpAgentControlPlaneClient } from './transport'
import { connectAgentHost } from './enrollment'
import { loadOrCreateDeviceKeyPair } from './device-key'
import { loadStoredConnection, saveStoredConnection } from './connection'

const [command, ...args] = process.argv.slice(2)
const configPath = option(args, '--config')
if (command === 'connect') {
  const code = args.find((value) => !value.startsWith('--') && value !== option(args, '--server') && value !== option(args, '--state-dir') && value !== option(args, '--name'))
  const serverUrl = option(args, '--server')
  if (!code || !serverUrl) usage()
  const stateDirectory = option(args, '--state-dir') ?? join(homedir(), '.overlay', 'agent-host')
  const connection = await connectAgentHost({
    code,
    serverUrl,
    stateDirectory,
    name: option(args, '--name'),
    onPendingApproval: ({ verificationPhrase }) => {
      process.stdout.write(`Verify this phrase in Overlay: ${verificationPhrase}\nWaiting for approval…\n`)
    },
  })
  process.stdout.write(`Connected ${connection.environmentId}. Credential stored with mode 0600 in ${stateDirectory}.\n`)
} else if (!configPath || (command !== 'run' && command !== 'doctor')) {
  usage()
} else {
  const config = await loadAgentHostConfig(configPath)
  const adapters = buildAdapters(config.adapters)
  if (command === 'doctor') {
  const checks = await diagnoseHost(config, adapters)
  for (const check of checks) process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}\n`)
  if (checks.some((check) => !check.ok)) process.exitCode = 1
  } else {
    if (!config.credential) throw new Error(`agent host credential is missing from ${config.credentialEnv} and local connection state`)
    const keys = await loadOrCreateDeviceKeyPair(config.stateDirectory)
    const stored = await loadStoredConnection(config.stateDirectory)
    const logger = new StructuredLogger()
    const state = new SqliteHostStateStore(join(config.stateDirectory, 'host.sqlite'))
    const runtime = new AgentHostRuntime({
      environmentId: config.environmentId,
      workspaceId: config.workspaceId,
      filesystem: stored?.filesystemGrant ?? config.filesystem,
      adapters,
      state,
      controlPlane: new HttpAgentControlPlaneClient({
        baseUrl: config.controlPlaneUrl,
        environmentId: config.environmentId,
        credential: config.credential,
        credentialExpiresAt: stored?.expiresAt,
        privateKey: keys.privateKey,
        onCredentialRotated: stored ? async (credential) => {
          await saveStoredConnection(config.stateDirectory, { ...stored, ...credential })
        } : undefined,
      }),
      logger,
    })
    const controller = new AbortController()
    process.once('SIGINT', () => controller.abort(new Error('SIGINT')))
    process.once('SIGTERM', () => controller.abort(new Error('SIGTERM')))
    logger.info('agent host started', { environmentId: config.environmentId, adapters: adapters.map((adapter) => adapter.capability.id) })
    try { await runtime.run(controller.signal) } finally { state.close() }
  }
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
  process.stderr.write('Usage:\n  overlay-agent-host connect <code> --server https://getoverlay.io [--state-dir path] [--name name]\n  overlay-agent-host <run|doctor> --config /absolute/path/config.json\n')
  process.exit(2)
}
