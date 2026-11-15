import { join } from 'node:path'
import { homedir } from 'node:os'
import type { FilesystemGrant } from '@layernorm/overlay-agent-bridge-protocol'
import { loadAgentHostConfig, saveAgentHostConfig, type AgentHostConfig } from './config.js'
import { connectAgentHost } from './enrollment.js'
import { diagnoseHost } from './doctor.js'
import { loadOrCreateDeviceKeyPair } from './device-key.js'
import { loadStoredConnection, saveStoredConnection } from './connection.js'
import { installLaunchAgent, launchAgentStatus, uninstallLaunchAgent } from './launchd.js'
import { LocalToolExecutor } from './local-tools.js'
import { StructuredLogger } from './logger.js'
import { withPreviewHostingAccess } from './preview-hosting.js'
import { AgentHostRuntime } from './runtime.js'
import { assertSupportedNodeVersion } from './runtime-version.js'
import { HttpAgentControlPlaneClient } from './transport.js'

const PACKAGE_SPEC = '@layernorm/overlay-agent-host@0.5.0'

assertSupportedNodeVersion()

const [command, ...args] = process.argv.slice(2)
const configPath = option(args, '--config')
if (command === 'connect') {
  await connectFromArgs(args)
} else if (command === 'service') {
  const action = args[0]
  if (!configPath || !['install', 'uninstall', 'status'].includes(action ?? '')) usage()
  const config = await loadAgentHostConfig(configPath)
  if (action === 'install') {
    const path = await installLaunchAgent({ environmentId: config.environmentId, configPath, stateDirectory: config.stateDirectory, packageSpec: PACKAGE_SPEC })
    process.stdout.write(`Installed and started ${path}\n`)
  } else if (action === 'uninstall') {
    process.stdout.write(`Stopped and removed ${await uninstallLaunchAgent(config.environmentId)}\n`)
  } else {
    process.stdout.write((await launchAgentStatus(config.environmentId)).stdout)
  }
} else if (!configPath || (command !== 'run' && command !== 'doctor')) {
  usage()
} else {
  const config = await loadAgentHostConfig(configPath)
  if (command === 'doctor') {
    const checks = await diagnoseHost(config, new LocalToolExecutor({ stateDirectory: config.stateDirectory, grant: () => config.filesystem }))
    for (const check of checks) process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}\n`)
    if (checks.some((check) => !check.ok)) process.exitCode = 1
  } else {
    await withPreviewHostingAccess(option(args, '--hosting-auth-file') ?? config.hostingAuthFile, config.controlPlaneUrl, fetch => runHost(config, fetch))
  }
}

async function connectFromArgs(args: string[]) {
  if (args.includes('--adapter')) {
    process.stderr.write('Overlay no longer runs third-party agents. Connect this machine with --local-tools to let Overlay agents use it.\n')
    process.exit(2)
  }
  const valued = new Set(['--server', '--state-dir', '--name', '--kind', '--hosting-auth-file'].map((flag) => option(args, flag)))
  const code = args.find((value) => !value.startsWith('--') && !valued.has(value))
  const serverUrl = option(args, '--server')
  if (!code || !serverUrl) usage()
  const kind = option(args, '--kind')
  if (kind !== undefined && !['local', 'vps', 'external'].includes(kind)) usage()
  const hostingAuthFile = option(args, '--hosting-auth-file')
  await withPreviewHostingAccess(hostingAuthFile, serverUrl, async fetch => {
    const stateDirectory = option(args, '--state-dir') ?? join(homedir(), '.overlay', 'agent-host')
    const connection = await connectAgentHost({
      code,
      serverUrl,
      ...(fetch ? { fetch } : {}),
      stateDirectory,
      name: option(args, '--name'),
      kind: kind as 'local' | 'vps' | 'external' | undefined,
      localTools: await new LocalToolExecutor({ stateDirectory, grant: () => ({ mode: 'all_user_files' }) }).capability(),
      onPendingApproval: ({ verificationPhrase }) => {
        process.stdout.write(`Verify this phrase in Overlay: ${verificationPhrase}\nWaiting for approval…\n`)
      },
    })
    const persistentConfigPath = join(stateDirectory, 'config.json')
    const persistentConfig: Omit<AgentHostConfig, 'credential'> = {
      ...(hostingAuthFile ? { hostingAuthFile } : {}),
      environmentId: connection.environmentId,
      workspaceId: connection.workspaceId,
      controlPlaneUrl: connection.controlPlaneUrl,
      credentialEnv: 'OVERLAY_AGENT_HOST_CREDENTIAL',
      stateDirectory,
      filesystem: connection.filesystemGrant,
      localTools: true,
    }
    await saveAgentHostConfig(persistentConfigPath, persistentConfig)
    if (hostingAuthFile) process.stdout.write('Protected Preview restarts require a fresh private access file at the configured path.\n')
    process.stdout.write(`Connected ${connection.environmentId}. Credential and restart configuration stored with mode 0600 in ${stateDirectory}.\n`)
    process.stdout.write(`Restart later with: npx --yes --package node@24 --package ${PACKAGE_SPEC} overlay-agent-host run --config ${shellQuote(persistentConfigPath)}\n`)
    if (process.platform === 'darwin') {
      process.stdout.write(`Keep it online after Terminal closes with: npx --yes --package node@24 --package ${PACKAGE_SPEC} overlay-agent-host service install --config ${shellQuote(persistentConfigPath)}\n`)
    }
    if (args.includes('--run')) await runHost({ ...persistentConfig, credential: connection.token }, fetch)
  })
}

async function runHost(config: AgentHostConfig, fetch?: typeof globalThis.fetch) {
  if (!config.credential) throw new Error(`agent host credential is missing from ${config.credentialEnv} and local connection state`)
  const [keys, stored] = await Promise.all([loadOrCreateDeviceKeyPair(config.stateDirectory), loadStoredConnection(config.stateDirectory)])
  const logger = new StructuredLogger()
  let grant: FilesystemGrant = stored?.filesystemGrant ?? config.filesystem
  const runtime: AgentHostRuntime = new AgentHostRuntime({
    environmentId: config.environmentId,
    workspaceId: config.workspaceId,
    filesystem: grant,
    localTools: new LocalToolExecutor({ stateDirectory: config.stateDirectory, grant: () => grant }),
    controlPlane: new HttpAgentControlPlaneClient({
      ...(fetch ? { fetch } : {}),
      baseUrl: config.controlPlaneUrl,
      environmentId: config.environmentId,
      credential: config.credential,
      credentialExpiresAt: stored?.expiresAt,
      privateKey: keys.privateKey,
      onCredentialRotated: stored ? async (credential) => {
        await saveStoredConnection(config.stateDirectory, { ...stored, ...credential })
        grant = credential.filesystemGrant
        runtime.updateFilesystemGrant(credential.filesystemGrant)
      } : undefined,
    }),
    logger,
  })
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort(new Error('SIGINT')))
  process.once('SIGTERM', () => controller.abort(new Error('SIGTERM')))
  logger.info('agent host started', { environmentId: config.environmentId })
  await runtime.run(controller.signal)
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function usage(): never {
  process.stderr.write('Usage:\n  overlay-agent-host connect <code> --server https://getoverlay.io [--local-tools] [--state-dir path] [--name name] [--kind local|vps|external] [--hosting-auth-file path] [--run]\n  overlay-agent-host <run|doctor> --config /absolute/path/config.json [--hosting-auth-file path]\n  overlay-agent-host service <install|uninstall|status> --config /absolute/path/config.json\n')
  process.exit(2)
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
