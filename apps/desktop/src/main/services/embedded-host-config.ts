import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Pure embedded-host configuration: bundled runtime resolution, validation and
 * argv construction. Electron-free so unit tests can cover it directly.
 *
 * The host and the Node.js it runs on ship inside the app (see
 * scripts/build-agent-host-bundle.mjs); nothing is installed or downloaded on
 * the user's computer. agent-host-bundle/package.json pins the host version.
 */
export interface EmbeddedHostRuntime {
  /** The bundled Node.js binary. */
  nodePath: string
  /** The host's command-line entry, run by that binary. */
  cliPath: string
}

const HOST_CLI = 'overlay-agent-host.mjs'

export const ENROLLMENT_CODE_PATTERN = /^[A-Za-z0-9_-]{6,128}$/

export function isValidServerOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

/**
 * The runtime directory is `agent-host` in a packaged app's resources and
 * `agent-host-bundle/runtime` in a checkout (built by `npm run build:agent-host`).
 * An unpackaged development build may run another host checkout's `cli.mjs` for QA.
 */
export function resolveEmbeddedHostRuntime(
  input: { packaged: boolean; resourcesPath: string; appPath: string },
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync
): EmbeddedHostRuntime | null {
  const directory = input.packaged
    ? join(input.resourcesPath, 'agent-host')
    : join(input.appPath, 'agent-host-bundle', 'runtime')
  const override = env.OVERLAY_DESKTOP_DEV_HOST_CLI?.trim()
  const runtime = {
    nodePath: join(directory, 'node'),
    cliPath: !input.packaged && override && /^\/[^\0\n]+\/cli\.mjs$/.test(override) ? override : join(directory, HOST_CLI)
  }
  return exists(runtime.nodePath) && exists(runtime.cliPath) ? runtime : null
}

/** Connects this computer with local tools only; the host never starts a third-party harness. */
export function buildEmbeddedHostArgs(args: {
  code: string
  origin: string
  stateDir: string
  name: string
  hostingAuthFile?: string
}): string[] {
  return [
    'connect',
    args.code,
    '--server',
    args.origin,
    '--local-tools',
    '--state-dir',
    args.stateDir,
    '--name',
    args.name,
    '--kind',
    'local',
    '--run',
    ...(args.hostingAuthFile ? ['--hosting-auth-file', args.hostingAuthFile] : [])
  ]
}

/** Restarts an already connected host from its saved configuration (no enrollment code). */
export function buildEmbeddedHostRunArgs(args: { configPath: string }): string[] {
  return ['run', '--config', args.configPath]
}

/** The phrase the host prints while it waits for approval, so Overlay can match it to its enrollment. */
export function verificationPhraseFrom(line: string): string | null {
  const match = /Verify this phrase in Overlay: ([a-z]+(?:-[a-z]+){1,5})\s*$/.exec(line.trim())
  return match?.[1] ?? null
}
