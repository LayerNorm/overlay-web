export interface NativeTranscriptCitation {
  kind: 'file' | 'memory'
  sourceId: string
  title?: string
  snippet?: string
}

export interface NativeTranscriptCitationEntry {
  key: string
  citation: NativeTranscriptCitation
}

const MAX_CITATION_TITLE_LENGTH = 512
const MAX_CITATION_SNIPPET_LENGTH = 2_000
const MAX_CITATION_ENTRIES = 100
const CITATION_KEY = /^(?:0|[1-9][0-9]{0,5})$/

export function isNativeTranscriptCitationKey(value: unknown): value is string {
  return typeof value === 'string' && CITATION_KEY.test(value)
}

export function isNativeTranscriptResourceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value &&
    !/[\u0000-\u001f\u007f/\\]/.test(value) && !value.includes('..') && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || Object.getPrototypeOf(prototype) === null
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

export function normalizeNativeTranscriptCitation(value: unknown): NativeTranscriptCitation | null {
  if (!isPlainRecord(value)) return null
  const kind = ownDataValue(value, 'kind')
  const sourceId = ownDataValue(value, 'sourceId')
  if ((kind !== 'file' && kind !== 'memory') || !isNativeTranscriptResourceId(sourceId)) return null
  const title = ownDataValue(value, 'title')
  const snippet = ownDataValue(value, 'snippet')
  return {
    kind,
    sourceId,
    ...(typeof title === 'string' ? { title: title.slice(0, MAX_CITATION_TITLE_LENGTH) } : {}),
    ...(typeof snippet === 'string' ? { snippet: snippet.slice(0, MAX_CITATION_SNIPPET_LENGTH) } : {}),
  }
}

export function getNativeTranscriptCitationEntries(value: unknown): NativeTranscriptCitationEntry[] {
  if (value === null || typeof value !== 'object') return []
  let keys: string[]
  try {
    keys = Object.keys(value).filter(isNativeTranscriptCitationKey)
      .sort((left, right) => Number(left) - Number(right))
  } catch {
    return []
  }
  const entries: NativeTranscriptCitationEntry[] = []
  for (const key of keys) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue
      const citation = normalizeNativeTranscriptCitation(descriptor.value)
      if (citation) {
        entries.push({ key, citation })
        if (entries.length >= MAX_CITATION_ENTRIES) break
      }
    } catch {
      continue
    }
  }
  return entries
}
