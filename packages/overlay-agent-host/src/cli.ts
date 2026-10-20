import { join } from 'node:path'
import { homedir } from 'node:os'
import { AcpAgentAdapter } from './acp-adapter.js'
import { ACPX_AGENT_DISPLAY_NAMES, AcpxAgentAdapter, acpxAgentNameFor } from './acpx-adapter.js'
import type { AgentAdapter } from './adapter.js'
import { loadAgentHostConfig, managedRestorationAdapters, saveAgentHostConfig } from './config.js'
import type { AgentHostConfig } from './config.js'
import { diagnoseHost } from './doctor.js'
import { FakeAgentAdapter } from './fake-adapter.js'
import { StructuredLogger } from './logger.js'
import { AgentHostRuntime } from './runtime.js'
import { withPreviewHostingAccess, type PreviewHostingTransport } from './preview-hosting.js'
import { SqliteHostStateStore } from './state.js'
import { HttpAgentControlPlaneClient } from './transport.js'
import { connectAgentHost } from './enrollment.js'
import { loadOrCreateDeviceKeyPair } from './device-key.js'
import { loadStoredConnection, saveStoredConnection } from './connection.js'
import { resolveAcpAdapterManifest } from './adapter-manifests.js'
import { EveAgentAdapter } from './eve-adapter.js'
import { assertSupportedNodeVersion } from './runtime-version.js'
import { installLaunchAgent, launchAgentStatus, uninstallLaunchAgent } from './launchd.js'
import { checkOverlayImage } from './image-check.js'
import { exportConfig } from './export-config.js'
import { isAgentProfileHarness } from '@layernorm/overlay-agent-bridge-protocol'

const PACKAGE_SPEC = '@layernorm/overlay-agent-host@0.4.3'

assertSupportedNodeVersion()

const [command, ...args] = process.argv.slice(2)
const configPath = option(args, '--config')
if (command === 'image-check') {
  const checks = checkOverlayImage()
  for (const check of checks) process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}\n`)
  if (checks.some((check) => !check.ok)) process.exitCode = 1
} else if (command === 'export-config') {
  // overlay-agent-host export-config <claude-code|codex> --server <url> --code <code> [--dry-run]
  const harness = args.find((value) => !value.startsWith('--') && value !== option(args, '--server') && value !== option(args, '--code') && value !== option(args, '--home'))
  const serverUrl = option(args, '--server')
  const code = option(args, '--code')
  const dryRun = args.includes('--dry-run')
  if (!isAgentProfileHarness(harness === 'claude' ? 'claude-code' : harness) || (!dryRun && (!serverUrl || !code))) {
    process.stderr.write('Usage: overlay-agent-host export-config <claude-code|codex> --server <url> --code <code> [--dry-run]\n')
    process.exit(2)
  }
  try {
    await exportConfig({
      harness: (harness === 'claude' ? 'claude-code' : harness) as 'claude-code' | 'codex',
      serverUrl: serverUrl ?? '', code: code ?? '', dryRun,
      ...(option(args, '--home') ? { home: option(args, '--home')! } : {}),
    })
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
} else if (command === 'connect') {
  await connectFromArgs(args)
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
  if (command === 'doctor') {
  const checks = await diagnoseHost(config, buildAdapters(config.adapters, config.stateDirectory))
  for (const check of checks) process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}\n`)
  if (checks.some((check) => !check.ok)) process.exitCode = 1
  } else {
    await withPreviewHostingAccess(option(args, '--hosting-auth-file') ?? config.hostingAuthFile, config.controlPlaneUrl, hosting => runHost(config, hosting))
  }
}

async function connectFromArgs(args: string[]) {
  const code = args.find((value) => !value.startsWith('--') && value !== option(args, '--server') && value !== option(args, '--state-dir') && value !== option(args, '--name') && value !== option(args, '--hosting-auth-file'))
  const serverUrl = option(args, '--server')
  if (!code || !serverUrl) usage()
  const hostingAuthFile = option(args, '--hosting-auth-file')
  await withPreviewHostingAccess(hostingAuthFile, serverUrl, async hosting => {
    const stateDirectory = option(args, '--state-dir') ?? join(homedir(), '.overlay', 'agent-host')
    const adapterIds = options(args, '--adapter')
    // `--engine acpx` runs ACP agents through acpx's runtime (Overlay Cloud machines use it).
    const useAcpx = option(args, '--engine') === 'acpx'
    const adapterConfigs: AgentHostConfig['adapters'] = (adapterIds.length ? adapterIds : ['codex', 'claude-code']).map((id) => {
      if (id === 'eve') {
        const host = option(args, '--eve-url')
        if (!host) throw new Error('--adapter eve requires --eve-url <url>')
        return { id: 'eve', displayName: 'Eve agent', protocol: 'eve' as const, host,
          ...(option(args, '--eve-auth-env') ? { bearerTokenEnv: option(args, '--eve-auth-env') } : {}) }
      }
      const manifest = resolveAcpAdapterManifest(id)
      if (useAcpx && acpxAgentNameFor(id)) {
        return { id, displayName: manifest?.displayName ?? ACPX_AGENT_DISPLAY_NAMES[id] ?? id, protocol: 'acpx' as const, agent: acpxAgentNameFor(id)! }
      }
      if (!manifest) throw new Error(`unknown ACP adapter manifest: ${id}`)
      return { ...manifest, args: [...manifest.args] }
    })
    // An Overlay Cloud machine must run the prepared image (pinned adapters, no credentials).
    if (option(args, '--kind') === 'overlay_cloud') {
      const failed = checkOverlayImage().filter((check) => !check.ok)
      if (failed.length) throw new Error(`not an Overlay agent image: ${failed.map((check) => check.detail).join('; ')}`)
    }
    const connection = await connectAgentHost({
      code,
      serverUrl,
      ...(hosting ? {fetch: hosting.fetch} : {}),
      ...(process.env.OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION === '2' ? { durableLifecycle: true } : {}),
      stateDirectory,
      name: option(args, '--name'),
      kind: option(args, '--kind') as 'local' | 'vps' | 'overlay_cloud' | 'external' | undefined,
      adapters: adapterConfigs.map((adapter) => ({
        id: adapter.id,
        displayName: adapter.displayName,
        protocol: adapter.protocol === 'acpx' ? 'acp' as const : adapter.protocol,
        supports: { prompt: true, approval: true, cancel: true, resume: true },
      })),
      onPendingApproval: ({ verificationPhrase }) => {
        process.stdout.write(`Verify this phrase in Overlay: ${verificationPhrase}\nWaiting for approval…\n`)
      },
    })
    const persistentConfigPath = join(stateDirectory, 'config.json')
    const persistentConfig: Omit<AgentHostConfig, 'credential'> = {
      ...(hostingAuthFile ? {hostingAuthFile} : {}),
      ...(process.env.OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION === '2' ? { durableLifecycle: true } : {}),
      environmentId: connection.environmentId,
      workspaceId: connection.workspaceId,
      controlPlaneUrl: connection.controlPlaneUrl,
      credentialEnv: 'OVERLAY_AGENT_HOST_CREDENTIAL',
      stateDirectory,
      filesystem: connection.filesystemGrant,
      adapters: managedRestorationAdapters(adapterConfigs, {
        durableLifecycle: process.env.OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION === '2',
        rollout: process.env.OVERLAY_REMOTE_RUN_FENCED_RESTORATION,
      }),
    }
    await saveAgentHostConfig(persistentConfigPath, persistentConfig)
    if (hostingAuthFile) process.stdout.write('Protected Preview restarts require managed provisioning to prepare a fresh private access file.\n')
    process.stdout.write(`Connected ${connection.environmentId}. Credential and restart configuration stored with mode 0600 in ${stateDirectory}.\n`)
    process.stdout.write(`Restart later with: npx --yes --package node@24 --package ${PACKAGE_SPEC} overlay-agent-host run --config ${shellQuote(persistentConfigPath)}\n`)
    if (process.platform === 'darwin') {
      process.stdout.write(`Keep it online after Terminal closes with: npx --yes --package node@24 --package ${PACKAGE_SPEC} overlay-agent-host service install --config ${shellQuote(persistentConfigPath)}\n`)
    }
    if (args.includes('--run')) {
      await runHost({
        ...persistentConfig,
        credential: connection.token,
      }, hosting)
    }
  })
}

async function runHost(config: AgentHostConfig, hosting?: PreviewHostingTransport) {
  const durableLifecycle = config.durableLifecycle === true || process.env.OVERLAY_REMOTE_RUN_LIFECYCLE_VERSION === '2'
  const configuredAdapters = managedRestorationAdapters(config.adapters, {
    durableLifecycle, rollout: process.env.OVERLAY_REMOTE_RUN_FENCED_RESTORATION,
  })
  const adapters = buildAdapters(configuredAdapters, config.stateDirectory).map(adapter => hosting ? hosting.wrapAdapter(adapter) : adapter)
  if (!config.credential) throw new Error(`agent host credential is missing from ${config.credentialEnv} and local connection state`)
  const [keys, stored] = await Promise.all([
    loadOrCreateDeviceKeyPair(config.stateDirectory),
    loadStoredConnection(config.stateDirectory),
  ])
  const logger = new StructuredLogger()
  const state = new SqliteHostStateStore(join(config.stateDirectory, 'host.sqlite'), {
    environmentId: config.environmentId,
    workspaceId: config.workspaceId,
  })
  const runtime = new AgentHostRuntime({
    durableLifecycle,
    // Only Overlay Cloud credentials carry this method (see the control plane's createCredential).
    fetchRunCredentials: stored?.methods.includes('agent:run-credentials') === true,
    environmentId: config.environmentId,
    workspaceId: config.workspaceId,
    filesystem: stored?.filesystemGrant ?? config.filesystem,
    drive: { stateDirectory: config.stateDirectory, apiUrl: new URL('/api/agent-drive', config.controlPlaneUrl).toString(),
      ...(hosting ? {fetch: hosting.fetch} : {}) },
    adapters,
    state,
    controlPlane: new HttpAgentControlPlaneClient({
      ...(hosting ? {fetch: hosting.fetch} : {}),
      baseUrl: config.controlPlaneUrl,
      environmentId: config.environmentId,
      credential: config.credential,
      credentialExpiresAt: stored?.expiresAt,
      privateKey: keys.privateKey,
      onCredentialRotated: stored ? async (credential) => {
        await saveStoredConnection(config.stateDirectory, { ...stored, ...credential })
        runtime.updateFilesystemGrant(credential.filesystemGrant)
      } : undefined,
    }),
    logger,
  })
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort(new Error('SIGINT')))
  process.once('SIGTERM', () => controller.abort(new Error('SIGTERM')))
  logger.info('agent host started', { environmentId: config.environmentId, adapters: adapters.map((adapter) => adapter.capability.id) })
  try { await runtime.run(controller.signal) } finally { if (runtime.canCloseState) state.close() }
}

function buildAdapters(configs: AgentHostConfigAdapter[], stateDirectory: string): AgentAdapter[] {
  return configs.map((adapter) => {
    if (adapter.protocol === 'fake') return new FakeAgentAdapter()
    if (adapter.protocol === 'acpx') return new AcpxAgentAdapter({
      id: adapter.id, displayName: adapter.displayName, agent: adapter.agent, stateDirectory,
      ...(adapter.fencedSessionRestoration === true ? {fencedSessionRestoration: true} : {}),
      ...(adapter.env ? { env: adapter.env } : {}),
    })
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
      ...(adapter.fencedSessionRestoration === true ? {fencedSessionRestoration: true} : {}),
      ...(adapter.args ? { args: adapter.args } : {}), ...(adapter.env ? { env: adapter.env } : {}),
    })
  })
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
  process.stderr.write('Usage:\n  overlay-agent-host connect <code> --server https://getoverlay.io [--state-dir path] [--name name] [--kind local|vps|overlay_cloud|external] [--engine acpx] [--hosting-auth-file path] [--run] [--adapter codex|claude-code] [--adapter eve --eve-url http://127.0.0.1:3000 --eve-auth-env EVE_AGENT_TOKEN]\n  overlay-agent-host <run|doctor> --config /absolute/path/config.json [--hosting-auth-file path]\n  overlay-agent-host image-check\n  overlay-agent-host service <install|uninstall|status> --config /absolute/path/config.json\n')
  process.exit(2)
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
