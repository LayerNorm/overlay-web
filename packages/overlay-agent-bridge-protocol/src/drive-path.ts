/** Portable wire paths. Reject aliases rather than silently normalizing file identity. */
export function drivePathSegments(path: string): string[] {
  if (!path || path.length > 4096 || path.includes('\\') || path.includes('\0') || path.startsWith('/')) throw Error('DRIVE_UNSAFE_PATH')
  const segments = path.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.length > 255
    || /[\u0000-\u001f\u007f<>:"|?*]/u.test(segment) || /[. ]$/.test(segment)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) throw Error('DRIVE_UNSAFE_PATH')
  return segments
}

export function portableDrivePathKey(path: string): string {
  drivePathSegments(path)
  return path.normalize('NFC').toLowerCase()
}
