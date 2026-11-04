export type PublicTrace = { parts: unknown[]; legacy: boolean }

export async function readPublicTrace(response: Response): Promise<PublicTrace | null> {
  if (response.status === 404) return null
  if (!response.ok || !response.body) throw new Error('Could not load the complete trace.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parts: unknown[] = []
  const text: string[] = []
  let buffer = ''
  let previous = -1
  try {
    for (;;) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        if (!line.trim()) continue
        const record = JSON.parse(line)
        if (record.type === 'done') {
          if (typeof record.resultSummary === 'string' && record.resultSummary.trim()
            && !text.join('\n\n').includes(record.resultSummary)) {
            parts.push({ type: 'text', text: record.resultSummary })
          }
          return { parts, legacy: record.legacy === true }
        }
        if (record.type !== 'step' || !Number.isSafeInteger(record.sequence) || record.sequence <= previous
          || !record.persistence || !Array.isArray(record.persistence.parts) || typeof record.persistence.content !== 'string') {
          throw new Error('Could not load the complete trace.')
        }
        previous = record.sequence
        parts.push(...record.persistence.parts)
        text.push(...record.persistence.parts.flatMap((part: { type?: string; text?: string } | null) =>
          part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
      }
      if (chunk.done) throw new Error('The trace connection ended before it finished.')
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
