export type FileViewerType =
  | 'text'
  | 'html'
  | 'markdown'
  | 'csv'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'document'
  | 'binary'

export type FileViewerUrlUsage = 'media' | 'pdf' | 'document' | 'download' | 'external'

const SAFE_DATA_MEDIA_URL = /^data:(image\/(?:avif|bmp|gif|jpeg|png|svg\+xml|webp)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+);base64,/i
const SAFE_ENCODED_SVG_URL = /^data:image\/svg\+xml(?:;charset=[a-z0-9_-]+)?,/i

/**
 * Resolves URLs before they reach an iframe, media element, or host operation.
 * Relative app routes are permitted for authenticated web content, while
 * executable schemes and protocol-relative URLs are rejected everywhere.
 */
export function resolveSafeViewerUrl(
  value: string | null | undefined,
  usage: FileViewerUrlUsage,
): string | undefined {
  const candidate = value?.trim()
  if (!candidate) return undefined

  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    return usage === 'external' ? undefined : candidate
  }
  if (candidate.startsWith('blob:')) {
    return usage === 'external' ? undefined : candidate
  }
  if (candidate.startsWith('data:')) {
    return usage === 'media' && (SAFE_DATA_MEDIA_URL.test(candidate) || SAFE_ENCODED_SVG_URL.test(candidate))
      ? candidate
      : undefined
  }

  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.toString()
      : undefined
  } catch {
    return undefined
  }
}

/** Deliberately excludes same-origin, navigation, popups, and downloads. */
export const FILE_VIEWER_HTML_SANDBOX = 'allow-scripts allow-forms allow-modals'

export function getFileType(filename: string): FileViewerType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['md', 'markdown'].includes(ext)) return 'markdown'
  if (
    ['txt', 'log', 'sh', 'py', 'js', 'ts', 'tsx', 'jsx', 'json', 'css', 'xml', 'yaml', 'yml', 'toml', 'go', 'rs', 'java', 'c', 'cpp', 'h'].includes(ext)
  ) return 'text'
  if (['html', 'htm'].includes(ext)) return 'html'
  if (ext === 'csv') return 'csv'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio'
  if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'ogv', 'm4v'].includes(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  if (['docx', 'doc'].includes(ext)) return 'document'
  return 'binary'
}

export function isEditableType(filename: string): boolean {
  const type = getFileType(filename)
  return type === 'text' || type === 'html' || type === 'markdown'
}

export function isPreviewableType(filename: string): boolean {
  return getFileType(filename) !== 'binary'
}

export function prefersUrlPreview(filename: string): boolean {
  const type = getFileType(filename)
  return type === 'pdf' || type === 'image' || type === 'audio' || type === 'video' || type === 'document'
}

export function shouldFetchTextContent(filename: string): boolean {
  const type = getFileType(filename)
  return type === 'text' || type === 'html' || type === 'markdown' || type === 'csv'
}
