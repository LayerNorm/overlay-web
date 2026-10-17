import { drivePathSegments, type DriveSyncStatus } from '@layernorm/overlay-agent-bridge-protocol'

export function savedDriveLinkTargets(input: { status: DriveSyncStatus | undefined; filesHref: string }): string {
  const targets = new URLSearchParams()
  if (input.status?.state === 'saved') {
    for (const entry of input.status.entries) {
      targets.append(entry.path, `${input.filesHref}?${entry.kind === 'folder' ? 'folder' : 'file'}=${encodeURIComponent(entry.fileId)}`)
    }
  }
  targets.sort()
  return targets.toString()
}

/** Resolve only exact saved entries; a provider's path is never a new filesystem grant. */
export function savedDriveHref(input: { href: string; targets: URLSearchParams }): string | undefined {
  const hashAt = input.href.indexOf('#')
  const rawPath = hashAt < 0 ? input.href : input.href.slice(0, hashAt)
  if (rawPath.includes('?')) return undefined
  let path: string
  try { path = decodeURIComponent(rawPath) } catch { return undefined }
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return undefined
  if (path.startsWith('/home/user/drive/')) path = path.slice('/home/user/drive/'.length)
  else if (path.startsWith('~/drive/')) path = path.slice('~/drive/'.length)
  else if (path.startsWith('/')) return undefined
  path = path.replace(/^(?:\.\/)+/, '')
  try { drivePathSegments(path) } catch { return undefined }
  const matches = input.targets.getAll(path)
  if (matches.length !== 1) return undefined
  return matches[0] + (hashAt < 0 ? '' : input.href.slice(hashAt))
}
