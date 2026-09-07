import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Pure embedded-host configuration: package pin, validation, npx resolution,
 * and argv construction. Electron-free so unit tests can cover it directly.
 *
 * Keep EMBEDDED_HOST_PACKAGE_SPEC in sync with OVERLAY_AGENT_HOST_PACKAGE_VERSION
 * in the web `src/server/agents/agent-enrollment-command.ts`.
 */
export const EMBEDDED_HOST_PACKAGE_SPEC = '@layernorm/overlay-agent-host@0.3.5'
export const EMBEDDED_HOST_NODE_SPEC = 'node@24'

export const EMBEDDED_HOST_ADAPTERS = ['codex', 'claude-code', 'hermes'] as const
export type EmbeddedHostAdapter = (typeof EMBEDDED_HOST_ADAPTERS)[number]

export const ENROLLMENT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{3,127}$/

export function isEmbeddedHostAdapter(value: unknown): value is EmbeddedHostAdapter {
  return (
    typeof value === 'string' &&
    (EMBEDDED_HOST_ADAPTERS as readonly string[]).includes(value)
  )
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
  return candidates.find((candidate) => {
    try {
      return exists(candidate)
    } catch {
      return false
    }
  }) ?? null
}

export function buildEmbeddedHostArgs(args: {
  code: string
  adapterId: EmbeddedHostAdapter
  origin: string
  stateDir: string
  name: string
}): string[] {
  return [
    '--yes',
    '--package',
    EMBEDDED_HOST_NODE_SPEC,
    '--package',
    EMBEDDED_HOST_PACKAGE_SPEC,
    'overlay-agent-host',
    'connect',
    args.code,
    '--server',
    args.origin,
    '--adapter',
    args.adapterId,
    '--state-dir',
    args.stateDir,
    '--name',
    args.name,
    '--kind',
    'local',
    '--run'
  ]
}
