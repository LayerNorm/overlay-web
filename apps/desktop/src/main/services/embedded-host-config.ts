import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Pure embedded-host configuration: package pin, validation, npx resolution,
 * and argv construction. Electron-free so unit tests can cover it directly.
 *
 * Keep EMBEDDED_HOST_PACKAGE_SPEC in sync with OVERLAY_AGENT_HOST_PACKAGE_VERSION
 * in the web `src/server/agents/agent-enrollment-command.ts`.
 */
export const EMBEDDED_HOST_PACKAGE_SPEC = '@layernorm/overlay-agent-host@0.5.0'
export const EMBEDDED_HOST_NODE_SPEC = 'node@24'

export const EMBEDDED_HOST_ADAPTERS = ['codex', 'claude-code', 'hermes'] as const
export type EmbeddedHostAdapter = (typeof EMBEDDED_HOST_ADAPTERS)[number]

export const ENROLLMENT_CODE_PATTERN = /^[A-Za-z0-9_-]{6,128}$/

export function isEmbeddedHostAdapter(value: unknown): value is EmbeddedHostAdapter {
  return typeof value === 'string' && (EMBEDDED_HOST_ADAPTERS as readonly string[]).includes(value)
}

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

const FALLBACK_NPX_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/local/bin',
  '/usr/bin',
  '/bin'
]

/** npx resolution without a shell: explicit PATH scan plus fixed macOS locations. */
export function resolveNpxPath(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync
): string | null {
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    const trimmed = directory.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      candidates.push(join(trimmed, 'npx'))
    }
  }
  for (const directory of FALLBACK_NPX_DIRS) {
    if (!seen.has(directory)) {
      seen.add(directory)
      candidates.push(join(directory, 'npx'))
    }
  }
  return (
    candidates.find((candidate) => {
      try {
        return exists(candidate)
      } catch {
        return false
      }
    }) ?? null
  )
}

/**
 * Unpackaged development builds may run a locally packed host tarball for QA.
 * Packaged builds always use the pinned registry release.
 */
export function embeddedHostPackageSpec(
  env: NodeJS.ProcessEnv = process.env,
  packaged = true
): string {
  const override = env.OVERLAY_DESKTOP_DEV_HOST_PACKAGE?.trim()
  if (!packaged && override && /^\/[^\0\n]+\.tgz$/.test(override)) return override
  return EMBEDDED_HOST_PACKAGE_SPEC
}

export function buildEmbeddedHostArgs(args: {
  code: string
  adapterId?: EmbeddedHostAdapter
  /** Serve Overlay's own tools on this Mac. With no adapter the host starts no third-party agent. */
  localTools?: boolean
  origin: string
  stateDir: string
  name: string
  hostingAuthFile?: string
  packageSpec?: string
}): string[] {
  if (!args.adapterId && !args.localTools) throw new Error('Choose a harness or local tools.')
  return [
    '--yes',
    '--package',
    EMBEDDED_HOST_NODE_SPEC,
    '--package',
    args.packageSpec ?? EMBEDDED_HOST_PACKAGE_SPEC,
    'overlay-agent-host',
    'connect',
    args.code,
    '--server',
    args.origin,
    ...(args.adapterId ? ['--adapter', args.adapterId] : []),
    ...(args.localTools ? ['--local-tools'] : []),
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
export function buildEmbeddedHostRunArgs(args: { configPath: string; packageSpec?: string }): string[] {
  return [
    '--yes',
    '--package',
    EMBEDDED_HOST_NODE_SPEC,
    '--package',
    args.packageSpec ?? EMBEDDED_HOST_PACKAGE_SPEC,
    'overlay-agent-host',
    'run',
    '--config',
    args.configPath
  ]
}

/** The phrase the host prints while it waits for approval, so Overlay can match it to its enrollment. */
export function verificationPhraseFrom(line: string): string | null {
  const match = /Verify this phrase in Overlay: ([a-z]+(?:-[a-z]+){1,5})\s*$/.exec(line.trim())
  return match?.[1] ?? null
}
