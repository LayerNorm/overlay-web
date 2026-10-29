import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

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
  return bytesToHex(sha256(new TextEncoder().encode(json)))
}
