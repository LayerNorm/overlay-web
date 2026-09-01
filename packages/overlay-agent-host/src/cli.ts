import { join } from 'node:path'
import { homedir } from 'node:os'
import { AcpAgentAdapter } from './acp-adapter.js'
import type { AgentAdapter } from './adapter.js'
import { loadAgentHostConfig, saveAgentHostConfig } from './config.js'
import type { AgentHostConfig } from './config.js'
import { diagnoseHost } from './doctor.js'
import { FakeAgentAdapter } from './fake-adapter.js'
import { StructuredLogger } from './logger.js'
import { AgentHostRuntime } from './runtime.js'
import { SqliteHostStateStore } from './state.js'
import { HttpAgentControlPlaneClient } from './transport.js'
import { connectAgentHost } from './enrollment.js'
import { loadOrCreateDeviceKeyPair } from './device-key.js'
import { loadStoredConnection, saveStoredConnection } from './connection.js'
import { resolveAcpAdapterManifest } from './adapter-manifests.js'
import { EveAgentAdapter } from './eve-adapter.js'
import { verifyHermesAcpReadiness } from './hermes-readiness.js'
import { assertSupportedNodeVersion } from './runtime-version.js'
import { installLaunchAgent, launchAgentStatus, uninstallLaunchAgent } from './launchd.js'

const PACKAGE_SPEC = '@layernorm/overlay-agent-host@0.3.1'

assertSupportedNodeVersion()

const [command, ...args] = process.argv.slice(2)
const configPath = option(args, '--config')
if (command === 'connect') {
  const code = args.find((value) => !value.startsWith('--') && value !== option(args, '--server') && value !== option(args, '--state-dir') && value !== option(args, '--name'))
  const serverUrl = option(args, '--server')
  if (!code || !serverUrl) usage()
  const stateDirectory = option(args, '--state-dir') ?? join(homedir(), '.overlay', 'agent-host')
  const adapterIds = options(args, '--adapter')
  const adapterConfigs: AgentHostConfig['adapters'] = (adapterIds.length ? adapterIds : ['codex', 'claude-code']).map((id) => {
    if (id === 'eve') {
      const host = option(args, '--eve-url')
      if (!host) throw new Error('--adapter eve requires --eve-url <url>')
      return { id: 'eve', displayName: 'Eve agent', protocol: 'eve' as const, host,
        ...(option(args, '--eve-auth-env') ? { bearerTokenEnv: option(args, '--eve-auth-env') } : {}) }
    }
    const manifest = resolveAcpAdapterManifest(id)
    if (!manifest) throw new Error(`unknown ACP adapter manifest: ${id}`)
    return { ...manifest, args: [...manifest.args] }
  })
  if (adapterIds.includes('hermes')) await verifyHermesAcpReadiness()
  const connection = await connectAgentHost({
    code,
    serverUrl,
    stateDirectory,
    name: option(args, '--name'),
    kind: option(args, '--kind') as 'local' | 'vps' | 'overlay_cloud' | 'external' | undefined,
    adapters: adapterConfigs.map((adapter) => ({
      id: adapter.id,
      displayName: adapter.displayName,
      protocol: adapter.protocol,
      supports: { prompt: true, approval: true, cancel: true, resume: true },
    })),
    onPendingApproval: ({ verificationPhrase }) => {
      process.stdout.write(`Verify this phrase in Overlay: ${verificationPhrase}\nWaiting for approval…\n`)
    },
  })
  const persistentConfigPath = join(stateDirectory, 'config.json')
  const persistentConfig: Omit<AgentHostConfig, 'credential'> = {
    environmentId: connection.environmentId,
    workspaceId: connection.workspaceId,
    controlPlaneUrl: connection.controlPlaneUrl,
    credentialEnv: 'OVERLAY_AGENT_HOST_CREDENTIAL',
    stateDirectory,
    filesystem: connection.filesystemGrant,
    adapters: adapterConfigs,
  }
  await saveAgentHostConfig(persistentConfigPath, persistentConfig)
  process.stdout.write(`Connected ${connection.environmentId}. Credential and restart configuration stored with mode 0600 in ${stateDirectory}.\n`)
  process.stdout.write(`Restart later with: npx --yes --package node@24 --package ${PACKAGE_SPEC} overlay-agent-host run --config ${shellQuote(persistentConfigPath)}\n`)
  if (process.platform === 'darwin') {
    process.stdout.write(`Keep it online after Terminal closes with: npx --yes --package node@24 --package ${PACKAGE_SPEC} overlay-agent-host service install --config ${shellQuote(persistentConfigPath)}\n`)
  }
  if (args.includes('--run')) {
    await runHost({
      ...persistentConfig,
      credential: connection.token,
    })
  }
} else if (command === 'service') {
  const action = args[0]
  if (!configPath || !['install', 'uninstall', 'status'].includes(action ?? '')) usage()
  const config = await loadAgentHostConfig(configPath)
  if (action === 'install') {
    const path = await installLaunchAgent({
      environmentId: config.environmentId,
      configPath,
      stateDirectory: config.stateDirectory,
      packageSpec: PACKAGE_SPEC,
    })
    process.stdout.write(`Installed and started ${path}\n`)
  } else if (action === 'uninstall') {
    const path = await uninstallLaunchAgent(config.environmentId)
    process.stdout.write(`Stopped and removed ${path}\n`)
  } else {
    const status = await launchAgentStatus(config.environmentId)
    process.stdout.write(status.stdout)
  }
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
    await runHost(config, adapters)
  }
}

async function runHost(config: AgentHostConfig, prebuiltAdapters?: AgentAdapter[]) {
  const adapters = prebuiltAdapters ?? buildAdapters(config.adapters)
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

function buildAdapters(configs: AgentHostConfigAdapter[]): AgentAdapter[] {
  return configs.map((adapter) => {
    if (adapter.protocol === 'fake') return new FakeAgentAdapter()
    if (adapter.protocol === 'eve') return new EveAgentAdapter({
      id: adapter.id, displayName: adapter.displayName, host: adapter.host,
      ...(adapter.bearerTokenEnv ? { bearerToken: () => {
        const token = process.env[adapter.bearerTokenEnv!]?.trim()
        if (!token) throw new Error(`Eve bearer token is missing from ${adapter.bearerTokenEnv}`)
        return token
      } } : {}),
    })
    return new AcpAgentAdapter({
      id: adapter.id, displayName: adapter.displayName, command: adapter.command,
      ...(adapter.args ? { args: adapter.args } : {}), ...(adapter.env ? { env: adapter.env } : {}),
      ...(isHermesManifestAdapter(adapter) ? { verify: verifyHermesAcpReadiness } : {}),
    })
  })
}

function isHermesManifestAdapter(adapter: AgentHostConfigAdapter): boolean {
  return adapter.protocol === 'acp'
    && adapter.id === 'hermes'
    && adapter.command === 'hermes'
    && adapter.args?.length === 1
    && adapter.args[0] === 'acp'
}

type AgentHostConfigAdapter = Awaited<ReturnType<typeof loadAgentHostConfig>>['adapters'][number]

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function options(args: string[], name: string): string[] {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]] : [])
}

function usage(): never {
  process.stderr.write('Usage:\n  overlay-agent-host connect <code> --server https://getoverlay.io [--state-dir path] [--name name] [--kind local|vps|overlay_cloud|external] [--run] [--adapter codex|claude-code|hermes] [--adapter eve --eve-url http://127.0.0.1:3000 --eve-auth-env EVE_AGENT_TOKEN]\n  overlay-agent-host <run|doctor> --config /absolute/path/config.json\n  overlay-agent-host service <install|uninstall|status> --config /absolute/path/config.json\n')
  process.exit(2)
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
