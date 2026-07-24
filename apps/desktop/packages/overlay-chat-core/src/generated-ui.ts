export const GENERATED_UI_DATA_TYPE = 'overlay.generated_ui' as const
export const GENERATED_UI_VERSION = 1 as const

export type GeneratedUiKind = 'draft.text' | 'draft.email' | 'connector.connect'

export type GeneratedUiVariant = {
  id: string
  label: string
  subject?: string
  body: string
}

export type GeneratedTextDraftData = {
  version: typeof GENERATED_UI_VERSION
  kind: 'draft.text'
  title?: string
  body: string
  format?: 'plain' | 'markdown'
}

export type GeneratedEmailDraftData = {
  version: typeof GENERATED_UI_VERSION
  kind: 'draft.email'
  subject: string
  body: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  provider?: 'gmail'
  variants?: GeneratedUiVariant[]
}

export type GeneratedConnectorData = {
  version: typeof GENERATED_UI_VERSION
  kind: 'connector.connect'
  serviceName: string
  slug?: string
  description?: string
  connectUrl?: string
  connected?: boolean
}

export type GeneratedUiData =
  | GeneratedTextDraftData
  | GeneratedEmailDraftData
  | GeneratedConnectorData

export type GeneratedUiPart = {
  type: 'data'
  id: string
  dataType: typeof GENERATED_UI_DATA_TYPE
  data: GeneratedUiData
  transient?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function streamingString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.map(nonEmptyString).filter((item): item is string => Boolean(item))
  return out.length ? out.slice(0, 20) : undefined
}

function normalizeVariant(value: unknown, index: number): GeneratedUiVariant | null {
  const record = asRecord(value)
  if (!record) return null
  const body = nonEmptyString(record.body)
  if (!body) return null
  return {
    id: nonEmptyString(record.id) ?? `variant-${index + 1}`,
    label: nonEmptyString(record.label) ?? `Variant ${index + 1}`,
    ...(optionalString(record.subject) ? { subject: optionalString(record.subject) } : {}),
    body,
  }
}

function normalizeVariants(value: unknown): GeneratedUiVariant[] | undefined {
  if (!Array.isArray(value)) return undefined
  const variants = value
    .map((item, index) => normalizeVariant(item, index))
    .filter((item): item is GeneratedUiVariant => Boolean(item))
    .slice(0, 6)
  return variants.length ? variants : undefined
}

export function normalizeGeneratedUiData(value: unknown): GeneratedUiData | null {
  const record = asRecord(value)
  if (!record || record.version !== GENERATED_UI_VERSION) return null
  if (record.kind === 'draft.text') {
    const body = nonEmptyString(record.body)
    if (!body) return null
    const format = record.format === 'markdown' ? 'markdown' : record.format === 'plain' ? 'plain' : undefined
    return {
      version: GENERATED_UI_VERSION,
      kind: 'draft.text',
      ...(optionalString(record.title) ? { title: optionalString(record.title) } : {}),
      body,
      ...(format ? { format } : {}),
    }
  }
  if (record.kind === 'draft.email') {
    const subject = nonEmptyString(record.subject)
    const body = nonEmptyString(record.body)
    if (!subject || !body) return null
    const provider = record.provider === 'gmail' ? 'gmail' : undefined
    const variants = normalizeVariants(record.variants)
    return {
      version: GENERATED_UI_VERSION,
      kind: 'draft.email',
      subject,
      body,
      ...(optionalStringArray(record.to) ? { to: optionalStringArray(record.to) } : {}),
      ...(optionalStringArray(record.cc) ? { cc: optionalStringArray(record.cc) } : {}),
      ...(optionalStringArray(record.bcc) ? { bcc: optionalStringArray(record.bcc) } : {}),
      ...(provider ? { provider } : {}),
      ...(variants ? { variants } : {}),
    }
  }
  if (record.kind === 'connector.connect') {
    const serviceName = nonEmptyString(record.serviceName)
    if (!serviceName) return null
    return {
      version: GENERATED_UI_VERSION,
      kind: 'connector.connect',
      serviceName,
      ...(optionalString(record.slug) ? { slug: optionalString(record.slug) } : {}),
      ...(optionalString(record.description) ? { description: optionalString(record.description) } : {}),
      ...(optionalString(record.connectUrl) ? { connectUrl: optionalString(record.connectUrl) } : {}),
      ...(typeof record.connected === 'boolean' ? { connected: record.connected } : {}),
    }
  }
  return null
}

export function isGeneratedUiData(value: unknown): value is GeneratedUiData {
  return normalizeGeneratedUiData(value) !== null
}

export function looksLikeCodeContent(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  if (/```|~~~/.test(text)) return true
  if (/<!doctype\s+html|<(?:html|head|body|style|script)\b/i.test(text)) return true
  if ((text.match(/<\/?[a-z][^>]*>/gi)?.length ?? 0) >= 2) return true
  if (/^\s*(?:import|export)\s+.+$/m.test(text)) return true
  if (/^\s*(?:const|let|var)\s+[$A-Z_a-z][$\w]*\s*=/m.test(text)) return true
  if (/^\s*(?:async\s+)?function\s+[$A-Z_a-z][$\w]*\s*\(/m.test(text)) return true
  if (/^\s*(?:def|class)\s+[A-Z_a-z]\w*\s*[:(]/m.test(text)) return true
  if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b[\s\S]*\b(?:FROM|INTO|TABLE|SET)\b/im.test(text)) return true
  if (/^\s*#!\/(?:usr\/bin\/env\s+)?(?:ba|z|fi)?sh\b/m.test(text)) return true
  if (/^\s*(?:npm|pnpm|yarn|bun|git|docker|kubectl|curl|node|python(?:3)?)\s+\S+/m.test(text)) return true
  if (/^\s*[^@\n{}]+\{[\s\S]*?[\w-]+\s*:\s*[^;{}]+;/m.test(text)) return true

  if (/^[{[]/.test(text)) {
    try {
      const parsed = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object') return true
    } catch {
      // Partial JSON is covered by the structural checks above.
    }
  }
  return false
}

export function generatedUiDraftContainsCode(value: unknown): boolean {
  const record = asRecord(value)
  if (!record || (record.kind !== 'draft.text' && record.kind !== 'draft.email')) return false
  if (typeof record.body === 'string' && looksLikeCodeContent(record.body)) return true
  if (!Array.isArray(record.variants)) return false
  return record.variants.some((variant) => {
    const variantRecord = asRecord(variant)
    return typeof variantRecord?.body === 'string' && looksLikeCodeContent(variantRecord.body)
  })
}

export function isGeneratedUiPart(value: unknown): value is GeneratedUiPart {
  const record = asRecord(value)
  if (!record) return false
  if (record.type !== 'data' || record.dataType !== GENERATED_UI_DATA_TYPE) return false
  if (!nonEmptyString(record.id)) return false
  return isGeneratedUiData(record.data)
}

export function generatedUiDataToPlainText(data: GeneratedUiData): string {
  if (data.kind === 'draft.text') {
    return [data.title, data.body].filter(Boolean).join('\n\n')
  }
  if (data.kind === 'draft.email') {
    const lines: string[] = []
    if (data.to?.length) lines.push(`To: ${data.to.join(', ')}`)
    if (data.cc?.length) lines.push(`Cc: ${data.cc.join(', ')}`)
    if (data.bcc?.length) lines.push(`Bcc: ${data.bcc.join(', ')}`)
    lines.push(`Subject: ${data.subject}`)
    lines.push(data.body)
    return lines.join('\n\n')
  }
  const lines = [data.serviceName]
  if (data.description) lines.push(data.description)
  if (data.connectUrl) lines.push(data.connectUrl)
  return lines.join('\n')
}

export function buildStreamingGeneratedUiPart(id: string, value: unknown): GeneratedUiPart | null {
  const record = asRecord(value)
  const partId = nonEmptyString(id)
  if (!record || !partId) return null

  if (record.kind === 'draft.text') {
    const body = streamingString(record.body)
    if (generatedUiDraftContainsCode(record)) return null
    return {
      type: 'data',
      id: partId,
      dataType: GENERATED_UI_DATA_TYPE,
      data: {
        version: GENERATED_UI_VERSION,
        kind: 'draft.text',
        ...(optionalString(record.title) ? { title: optionalString(record.title) } : {}),
        body,
        ...(record.format === 'markdown' || record.format === 'plain' ? { format: record.format } : {}),
      },
      transient: true,
    }
  }

  if (record.kind === 'draft.email') {
    const body = streamingString(record.body)
    if (generatedUiDraftContainsCode(record)) return null
    const variants = normalizeVariants(record.variants)
    return {
      type: 'data',
      id: partId,
      dataType: GENERATED_UI_DATA_TYPE,
      data: {
        version: GENERATED_UI_VERSION,
        kind: 'draft.email',
        subject: streamingString(record.subject),
        body,
        ...(optionalStringArray(record.to) ? { to: optionalStringArray(record.to) } : {}),
        ...(optionalStringArray(record.cc) ? { cc: optionalStringArray(record.cc) } : {}),
        ...(optionalStringArray(record.bcc) ? { bcc: optionalStringArray(record.bcc) } : {}),
        ...(record.provider === 'gmail' ? { provider: 'gmail' as const } : {}),
        ...(variants ? { variants } : {}),
      },
      transient: true,
    }
  }

  return null
}

export function buildGeneratedUiPart(id: string, data: unknown): GeneratedUiPart | null {
  const normalized = normalizeGeneratedUiData(data)
  const partId = nonEmptyString(id)
  if (!partId || !normalized) return null
  return {
    type: 'data',
    id: partId,
    dataType: GENERATED_UI_DATA_TYPE,
    data: normalized,
  }
}
