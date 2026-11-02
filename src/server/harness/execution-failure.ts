import { redactSecrets } from '@/shared/security/sentry-sanitize'

function field(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key]
  } catch (_error) {
    return undefined
  }
}

function safeText(value: string): string {
  return redactSecrets(value
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[REDACTED URL]')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b((?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]'))
    .replace(/[\r\n\t]+/g, ' ').trim()
}

// Workflow and provider failures can cross realms or arrive as serialized values.
// Never serialize the entire object: request bodies and headers can carry secrets.
export function harnessExecutionFailureReason(error: unknown): string {
  const seen = new Set<object>()
  const reasons: string[] = []
  let current = error
  for (let depth = 0; depth < 4 && current != null; depth++) {
    if (typeof current === 'string') {
      const message = safeText(current)
      if (message) reasons.push(message)
      break
    }
    if (typeof current !== 'object' || seen.has(current)) break
    seen.add(current)
    const message = field(current, 'message')
    const name = field(current, 'name')
    const code = field(current, 'code')
    const label = [name, code]
      .filter((value): value is string => typeof value === 'string'
        && value !== 'Error' && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value))
      .map(safeText).join(' / ')
    const detail = typeof message === 'string' ? safeText(message) : ''
    const reason = [label, detail].filter(Boolean).join(': ')
    if (reason && !reasons.includes(reason)) reasons.push(reason)
    current = field(current, 'cause')
  }
  return (reasons.join(' Caused by: ') || 'Harness execution failed without error details.').slice(0, 2_000)
}
