import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createAgentRegistry, resolveInstalledBuiltInAgentLaunch } from 'acpx/agent-registry'
import { ACPX_AGENT_NAMES } from './acpx-adapter.js'

/** Written by `infra/agent-image/provision.sh`; the image's identity and pinned versions. */
export const OVERLAY_IMAGE_MANIFEST_PATHS = ['/etc/overlay/image.json', '/opt/overlay/image.json'] as const

/** Image versions this host build accepts on an Overlay Cloud machine. */
/** v2 adds the run-credentials method to the bridge protocol; v1 hosts cannot parse Overlay Cloud credentials. */
export const SUPPORTED_OVERLAY_IMAGE_VERSIONS = { min: 2, max: 5 } as const

export type OverlayImageManifest = {
  imageVersion: number
  hostVersion: string
  packages: Record<string, string>
  builtAt: string
}

export type ImageCheck = { name: string; ok: boolean; detail: string }

/** Agent auth files that must never be baked into an image. */
export function credentialFilePaths(home = homedir()): string[] {
  return [
    join(home, '.claude', '.credentials.json'),
    join(home, '.codex', 'auth.json'),
    join(home, '.overlay', 'agent-host', 'connection.json'),
  ]
}

/** The installed (no-download) launch acpx would use for an agent, if any. */
function installedLaunchFor(agent: string): unknown {
  const command = createAgentRegistry().resolve(agent)
  return resolveInstalledBuiltInAgentLaunch(Array.isArray(command) ? command.join(' ') : command)
}

export function readImageManifest(paths: readonly string[] = OVERLAY_IMAGE_MANIFEST_PATHS): OverlayImageManifest | null {
  for (const path of paths) {
    if (!existsSync(path)) continue
    return JSON.parse(readFileSync(path, 'utf8')) as OverlayImageManifest
  }
  return null
}

export function checkOverlayImage(options: {
  manifest?: OverlayImageManifest | null
  home?: string
  exists?: (path: string) => boolean
  resolveAgent?: (agentCommand: string) => unknown
} = {}): ImageCheck[] {
  const manifest = options.manifest === undefined ? readImageManifest() : options.manifest
  const exists = options.exists ?? existsSync
  const resolveAgent = options.resolveAgent ?? installedLaunchFor
  const checks: ImageCheck[] = []
  const { min, max } = SUPPORTED_OVERLAY_IMAGE_VERSIONS
  checks.push(manifest
    ? {
      name: 'image-version',
      ok: manifest.imageVersion >= min && manifest.imageVersion <= max,
      detail: `image v${manifest.imageVersion} (this host supports v${min}–v${max})`,
    }
    : { name: 'image-version', ok: false, detail: `no image manifest at ${OVERLAY_IMAGE_MANIFEST_PATHS.join(' or ')}` })
  for (const [id, agent] of Object.entries(ACPX_AGENT_NAMES)) {
    const launch = resolveAgent(agent)
    checks.push({
      name: `agent:${id}`,
      ok: Boolean(launch),
      detail: launch ? `${agent} adapter is installed` : `${agent} adapter is not installed (would download at run time)`,
    })
  }
  const leaked = credentialFilePaths(options.home).filter((path) => exists(path))
  checks.push({
    name: 'credential-free',
    ok: leaked.length === 0,
    detail: leaked.length === 0 ? 'no agent or host credentials on disk' : `credentials present: ${leaked.join(', ')}`,
  })
  return checks
}
