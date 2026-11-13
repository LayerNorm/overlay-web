import type { PersistedFileReference } from './types'

const FILE_TOOL_NAMES = new Set([
  'computer_publish_file', 'create_note', 'update_note', 'append_to_note',
  'replace_note_section', 'edit_note', 'write_file',
])

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalPositiveNumber(recordValue: Record<string, unknown>, key: string): number | undefined {
  const value = recordValue[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function optionalNonNegativeNumber(recordValue: Record<string, unknown>, key: string): number | undefined {
  const value = recordValue[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function referenceFrom(value: unknown): PersistedFileReference | null {
  const source = record(value)
  const fileId = nonEmptyString(source?.fileId)
  const name = nonEmptyString(source?.name)
  const mimeType = nonEmptyString(source?.mimeType)
  const revision = nonEmptyString(source?.revision)
  const conversationId = nonEmptyString(source?.conversationId)
  if (!source || !fileId || fileId.length > 256 || !name || name.length > 255
    || !mimeType || mimeType.length > 255 || (revision?.length ?? 0) > 512
    || (conversationId?.length ?? 0) > 256) return null
  return {
    fileId,
    name,
    mimeType,
    ...(optionalNonNegativeNumber(source, 'sizeBytes') !== undefined ? { sizeBytes: optionalNonNegativeNumber(source, 'sizeBytes') } : {}),
    ...(revision ? { revision } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(optionalPositiveNumber(source, 'durationMs') ? { durationMs: optionalPositiveNumber(source, 'durationMs') } : {}),
    ...(optionalPositiveNumber(source, 'width') ? { width: optionalPositiveNumber(source, 'width') } : {}),
    ...(optionalPositiveNumber(source, 'height') ? { height: optionalPositiveNumber(source, 'height') } : {}),
  }
}

function legacyReference(toolName: string, output: Record<string, unknown>): PersistedFileReference | null {
  if (toolName === 'computer_publish_file') {
    const artifact = record(output.artifact)
    if (!artifact) return null
    return referenceFrom({
      fileId: artifact.fileId,
      name: artifact.name,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      revision: artifact.checksumSha256,
      conversationId: artifact.conversationId,
    })
  }
  const saved = record(output.saved)
  if (toolName === 'create_note') {
    const noteId = nonEmptyString(output.noteId)
    return noteId ? referenceFrom({
      fileId: noteId,
      name: saved?.title,
      mimeType: 'text/markdown',
      revision: output.revision,
      conversationId: output.conversationId,
    }) : null
  }
  if (toolName === 'update_note' || toolName === 'append_to_note'
    || toolName === 'replace_note_section' || toolName === 'edit_note') {
    const noteId = nonEmptyString(output.noteId)
    const name = nonEmptyString(saved?.title ?? output.title)
    return noteId && name ? referenceFrom({
      fileId: noteId,
      name,
      mimeType: 'text/markdown',
      revision: output.revision,
    }) : null
  }
  if (toolName === 'write_file') {
    const fileId = nonEmptyString(output.fileId)
    const name = nonEmptyString(saved?.name)
    if (!fileId || !name) return null
    const extension = name.split('.').pop()?.toLowerCase()
    const mimeType = extension === 'md' || extension === 'markdown'
      ? 'text/markdown'
      : extension === 'txt' ? 'text/plain'
        : extension === 'json' ? 'application/json'
          : extension === 'csv' ? 'text/csv' : 'application/octet-stream'
    return referenceFrom({ fileId, name, mimeType, revision: saved?.revision })
  }
  return null
}

function successfulOutput(value: unknown): Record<string, unknown> | null {
  const direct = record(value)
  if (direct?.success === false) return null
  if (direct?.success === true) return direct
  const display = record(direct?.display)
  return display?.success === true ? display : null
}

export function parsePersistedFileReference(
  toolName: string,
  result: unknown,
): PersistedFileReference | null {
  if (!FILE_TOOL_NAMES.has(toolName)) return null
  const output = successfulOutput(result)
  if (!output) return null
  return referenceFrom(output.fileReference) ?? legacyReference(toolName, output)
}

export function fileContentHref(fileId: string): string {
  return `/api/v1/files/${encodeURIComponent(fileId)}/content`
}

export function removeKnownFileMarkdown(text: string, fileIds: ReadonlySet<string>): string {
  const replaceKnownLinks = (source: string, expectedPaths: ReadonlySet<string>) => source.replace(
    /!?\[([^\]]*)\]\((<[^>]*>|[^)\s]+)(?:\s+[^)]*)?\)/g,
    (match, label: string, target: string) => {
      const href = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
      try {
        const baseOrigin = 'https://overlay.invalid'
        const url = new URL(href, baseOrigin)
        if (url.username || url.password) return match
        if (href.startsWith('//')) return match
        if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
          const host = url.hostname.toLowerCase()
          const trustedOrigin = url.protocol === 'https:' && (
            host === 'getoverlay.io' || host.endsWith('.getoverlay.io')
          ) || url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')
          if (!trustedOrigin) return match
        } else if (!href.startsWith('/') || url.origin !== baseOrigin) {
          return match
        }
        const notePath = url.pathname === '/app/notes' || /^\/app\/w\/[^/]+\/notes$/.test(url.pathname)
        const noteId = url.searchParams.get('id')
        return expectedPaths.has(url.pathname) || (notePath && noteId && fileIds.has(noteId)) ? label : match
      } catch {
        return match
      }
    },
  )

  let result = text
  if (!fileIds.size) return result
  const expectedPaths = new Set([...fileIds].map(fileContentHref))
  const fencedSegments = result.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
  result = fencedSegments.map((segment) => {
    if (segment.startsWith('```') || segment.startsWith('~~~')) return segment
    return segment.split(/(`+[^`\n]*`+)/g).map((part) => {
      if (part.startsWith('`') && part.endsWith('`')) return part
      return replaceKnownLinks(part, expectedPaths)
    }).join('')
  }).join('')
  return result
}
