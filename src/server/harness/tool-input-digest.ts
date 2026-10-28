import { createHash } from 'node:crypto'

function normalizeToolInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeToolInput)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, normalizeToolInput(entry)]),
    )
  }
  return value
}

export function harnessToolInputDigest(toolName: string, input: unknown): string {
  const json = JSON.stringify([toolName, normalizeToolInput(input)])
  if (json === undefined) throw new Error('Harness tool input must be JSON serializable.')
  return createHash('sha256').update(json).digest('hex')
}
