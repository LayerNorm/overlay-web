type MessagePartLike = {
  type: string
  text?: string
  url?: string
  mediaType?: string
  /** AI SDK file parts may use `filename` */
  filename?: string
  fileName?: string
}

type PersistedTextPart = {
  type: 'text'
  text: string
}

/** Convex `conversationMessages.parts` — file rows restore thumbnails after reload. */
export type PersistedFilePart = {
  type: 'file'
  url: string
  mediaType?: string
  fileName?: string
}

export type PersistedMessagePart = PersistedTextPart | PersistedFilePart

interface PersistenceOptions {
  attachmentNames?: string[]
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function summarizeAttachmentParts(
  parts?: MessagePartLike[],
  options: PersistenceOptions = {}
): string | null {
  if (!parts?.length) return null

  let imageCount = 0
  let videoCount = 0
  let fileCount = 0

  for (const part of parts) {
    if (part.type !== 'file') continue
    if (part.mediaType?.startsWith('image/')) {
      imageCount++
      continue
    }
    if (part.mediaType?.startsWith('video/')) {
      videoCount++
      continue
    }
    fileCount++
  }

  const segments: string[] = []
  if (imageCount > 0) segments.push(pluralize(imageCount, 'image'))
  if (videoCount > 0) segments.push(pluralize(videoCount, 'video'))
  if (fileCount > 0) segments.push(pluralize(fileCount, 'file'))
  if (segments.length === 0) return null

  const attachmentNames = (options.attachmentNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
  const namesSuffix = attachmentNames.length
    ? `: ${attachmentNames.slice(0, 3).join(', ')}${attachmentNames.length > 3 ? ` +${attachmentNames.length - 3} more` : ''}`
    : ''

  return `[Attached ${segments.join(', ')}${namesSuffix}]`
}

function fileDisplayName(part: MessagePartLike): string | undefined {
  const n = part.fileName?.trim() || part.filename?.trim()
  return n || undefined
}

export function sanitizeMessagePartsForPersistence(
  parts?: MessagePartLike[],
  options: PersistenceOptions = {}
): PersistedMessagePart[] | undefined {
  if (!parts?.length) return undefined

  const persistedParts: PersistedMessagePart[] = []

  for (const part of parts) {
    if (part.type === 'text') {
      const text = part.text?.trim()
      if (!text) continue
      persistedParts.push({ type: 'text', text })
      continue
    }
    if (part.type === 'file') {
      const url = typeof part.url === 'string' ? part.url.trim() : ''
      if (!url) continue
      const name = fileDisplayName(part)
      persistedParts.push({
        type: 'file',
        url,
        ...(part.mediaType ? { mediaType: part.mediaType } : {}),
        ...(name ? { fileName: name } : {}),
      })
    }
  }

  const attachmentSummary = summarizeAttachmentParts(parts, options)
  if (attachmentSummary) {
    persistedParts.push({ type: 'text', text: attachmentSummary })
  }

  return persistedParts.length > 0 ? persistedParts : undefined
}

export function buildPersistedMessageContent(
  content: string | undefined,
  parts?: MessagePartLike[],
  options: PersistenceOptions = {}
): string {
  const trimmed = content?.trim()
  if (trimmed) return trimmed
  return summarizeAttachmentParts(parts, options) ?? ''
}
