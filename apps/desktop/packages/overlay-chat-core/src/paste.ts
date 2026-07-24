export const LARGE_PASTE_WORD_LIMIT = 1_000
export const LARGE_PASTE_CHAR_LIMIT = 30_000
export const LARGE_PASTE_MAX_BYTES = 12 * 1024 * 1024

export function exceedsWordLimit(value: string, limit: number): boolean {
  let count = 0
  let inWord = false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    const isWhitespace = code <= 32 || code === 160
    if (isWhitespace) {
      inWord = false
    } else if (!inWord) {
      count += 1
      if (count > limit) return true
      inWord = true
    }
  }
  return false
}

export function pastedTextFileName(value: string): string {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  const base = (firstLine ?? 'pasted-text')
    .replace(/[^a-zA-Z0-9 ._-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .toLowerCase()
  return `${base || 'pasted-text'}.txt`
}

export function shouldAttachPastedTextAsFile(value: string): boolean {
  return value.length > LARGE_PASTE_CHAR_LIMIT || exceedsWordLimit(value, LARGE_PASTE_WORD_LIMIT)
}
