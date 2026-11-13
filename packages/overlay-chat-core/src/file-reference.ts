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

function findMarkdownFenceEnd(source: string, openingStart: number, delimiter: '`' | '~'): number {
  for (let index = openingStart + 3; index < source.length; index++) {
    if (source[index] === delimiter && source[index + 1] === delimiter && source[index + 2] === delimiter) {
      return index + 3
    }
  }
  return -1
}

function isMarkdownWhitespaceAt(source: string, index: number): boolean {
  const code = source.charCodeAt(index)
  return (code >= 0x09 && code <= 0x0d) || code === 0x20 || code === 0x00a0 || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029
    || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff
}

type MarkdownTargetParse =
  | { kind: 'complete'; href: string; end: number }
  | { kind: 'invalid'; resumeAt: number }
  | { kind: 'unterminated' }

function parseMarkdownLinkTarget(source: string, openParen: number): MarkdownTargetParse {
  let index = openParen + 1
  let href: string
  if (source[index] === '<') {
    const targetStart = ++index
    while (index < source.length && source[index] !== '>') index++
    if (index === source.length) return { kind: 'unterminated' }
    href = source.slice(targetStart, index)
    index++
    if (source[index] === ')') return { kind: 'complete', href, end: index + 1 }
    if (!isMarkdownWhitespaceAt(source, index)) return { kind: 'invalid', resumeAt: index }
  } else {
    const targetStart = index
    while (index < source.length && source[index] !== ')' && !isMarkdownWhitespaceAt(source, index)) index++
    if (index === targetStart) return { kind: 'invalid', resumeAt: index }
    href = source.slice(targetStart, index)
    if (source[index] === ')') return { kind: 'complete', href, end: index + 1 }
    while (index < source.length && source[index] !== ')') index++
    if (index === source.length) return { kind: 'unterminated' }
    return { kind: 'complete', href, end: index + 1 }
  }

  while (isMarkdownWhitespaceAt(source, index)) index++
  while (index < source.length && source[index] !== ')') index++
  if (index === source.length) return { kind: 'unterminated' }
  return { kind: 'complete', href, end: index + 1 }
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
}

function hasUriScheme(href: string): boolean {
  if (!isAsciiLetter(href.charCodeAt(0))) return false
  for (let index = 1; index < href.length; index++) {
    const code = href.charCodeAt(index)
    if (code === 0x3a) return true
    if (isAsciiLetter(code) || (code >= 0x30 && code <= 0x39)
      || code === 0x2b || code === 0x2d || code === 0x2e) continue
    return false
  }
  return false
}

function isWorkspaceNotePath(pathname: string): boolean {
  const prefix = '/app/w/'
  if (!pathname.startsWith(prefix)) return false
  const workspaceEnd = pathname.indexOf('/', prefix.length)
  return workspaceEnd > prefix.length && pathname.slice(workspaceEnd) === '/notes'
}

function isKnownFileHref(
  href: string,
  expectedPaths: ReadonlySet<string>,
  fileIds: ReadonlySet<string>,
): boolean {
  try {
    const baseOrigin = 'https://overlay.invalid'
    const url = new URL(href, baseOrigin)
    if (url.username || url.password || href.startsWith('//')) return false
    if (hasUriScheme(href)) {
      const host = url.hostname.toLowerCase()
      const trustedOrigin = (url.protocol === 'https:' && (
        host === 'getoverlay.io' || host.endsWith('.getoverlay.io')
      )) || (url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1'))
      if (!trustedOrigin) return false
    } else if (!href.startsWith('/') || url.origin !== baseOrigin) {
      return false
    }
    const notePath = url.pathname === '/app/notes' || isWorkspaceNotePath(url.pathname)
    const noteId = url.searchParams.get('id')
    return expectedPaths.has(url.pathname) || (notePath && !!noteId && fileIds.has(noteId))
  } catch {
    return false
  }
}

function replaceKnownMarkdownLinks(
  source: string,
  expectedPaths: ReadonlySet<string>,
  fileIds: ReadonlySet<string>,
): string {
  const parts: string[] = []
  let outputStart = 0
  let openBracket = -1
  for (let index = 0; index < source.length;) {
    if (source[index] === '[') {
      if (openBracket < 0) openBracket = index
      index++
      continue
    }
    if (source[index] !== ']' || openBracket < 0) {
      index++
      continue
    }

    const labelStart = openBracket
    openBracket = -1
    const openParen = index + 1
    if (source[openParen] !== '(') {
      index++
      continue
    }

    const target = parseMarkdownLinkTarget(source, openParen)
    if (target.kind === 'unterminated') {
      parts.push(source.slice(outputStart))
      return parts.join('')
    }
    if (target.kind === 'invalid') {
      index = Math.max(index + 1, target.resumeAt)
      continue
    }

    if (isKnownFileHref(target.href, expectedPaths, fileIds)) {
      const matchStart = labelStart > 0 && source[labelStart - 1] === '!' ? labelStart - 1 : labelStart
      parts.push(source.slice(outputStart, matchStart))
      parts.push(source.slice(labelStart + 1, index))
      outputStart = target.end
    }
    index = target.end
  }
  parts.push(source.slice(outputStart))
  return parts.join('')
}

function replaceKnownLinksOutsideInlineCode(
  source: string,
  expectedPaths: ReadonlySet<string>,
  fileIds: ReadonlySet<string>,
): string {
  const parts: string[] = []
  let segmentStart = 0
  let openTickStart = -1
  let openTickEnd = -1
  for (let index = 0; index < source.length;) {
    if (source[index] === '\n') {
      if (openTickStart < 0) {
        parts.push(replaceKnownMarkdownLinks(source.slice(segmentStart, index), expectedPaths, fileIds))
      } else {
        parts.push(replaceKnownMarkdownLinks(source.slice(segmentStart, openTickStart), expectedPaths, fileIds))
        parts.push(source.slice(openTickStart, openTickEnd))
        parts.push(replaceKnownMarkdownLinks(source.slice(openTickEnd, index), expectedPaths, fileIds))
      }
      parts.push('\n')
      segmentStart = index + 1
      openTickStart = -1
      openTickEnd = -1
      index++
      continue
    }
    if (source[index] !== '`') {
      index++
      continue
    }

    const tickStart = index
    let tickEnd = index + 1
    while (tickEnd < source.length && source[tickEnd] === '`') tickEnd++
    if (openTickStart < 0) {
      openTickStart = tickStart
      openTickEnd = tickEnd
    } else {
      parts.push(replaceKnownMarkdownLinks(source.slice(segmentStart, openTickStart), expectedPaths, fileIds))
      parts.push(source.slice(openTickStart, tickEnd))
      segmentStart = tickEnd
      openTickStart = -1
      openTickEnd = -1
    }
    index = tickEnd
  }

  if (openTickStart < 0) {
    parts.push(replaceKnownMarkdownLinks(source.slice(segmentStart), expectedPaths, fileIds))
  } else {
    parts.push(replaceKnownMarkdownLinks(source.slice(segmentStart, openTickStart), expectedPaths, fileIds))
    parts.push(source.slice(openTickStart, openTickEnd))
    parts.push(replaceKnownMarkdownLinks(source.slice(openTickEnd), expectedPaths, fileIds))
  }
  return parts.join('')
}

export function removeKnownFileMarkdown(text: string, fileIds: ReadonlySet<string>): string {
  if (!fileIds.size) return text
  const expectedPaths = new Set([...fileIds].map(fileContentHref))
  const parts: string[] = []
  let segmentStart = 0
  for (let index = 0; index < text.length;) {
    const delimiter = text[index]
    if ((delimiter !== '`' && delimiter !== '~')
      || text[index + 1] !== delimiter || text[index + 2] !== delimiter) {
      index++
      continue
    }

    const fenceEnd = findMarkdownFenceEnd(text, index, delimiter)
    if (fenceEnd < 0) {
      parts.push(replaceKnownLinksOutsideInlineCode(text.slice(segmentStart, index), expectedPaths, fileIds))
      parts.push(text.slice(index))
      return parts.join('')
    }
    parts.push(replaceKnownLinksOutsideInlineCode(text.slice(segmentStart, index), expectedPaths, fileIds))
    parts.push(text.slice(index, fenceEnd))
    segmentStart = fenceEnd
    index = fenceEnd
  }
  parts.push(replaceKnownLinksOutsideInlineCode(text.slice(segmentStart), expectedPaths, fileIds))
  return parts.join('')
}
