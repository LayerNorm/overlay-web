function stripReasoningBlocks(raw: string): string {
  const reasoningTag = /<(\/?)(think|thinking)\s*>/gi
  const openTags: string[] = []
  let cursor = 0
  let stripped = ''
  let match = reasoningTag.exec(raw)

  while (match) {
    const isClosingTag = match[1] === '/'
    const tagName = match[2]!.toLowerCase()
    const matchEnd = match.index + match[0].length

    if (!isClosingTag) {
      if (openTags.length === 0) {
        stripped += raw.slice(cursor, match.index)
        cursor = matchEnd
      }
      openTags.push(tagName)
    } else if (openTags.at(-1) === tagName) {
      openTags.pop()
      if (openTags.length === 0) cursor = matchEnd
    }

    match = reasoningTag.exec(raw)
  }

  if (openTags.length > 0) return stripped
  return stripped + raw.slice(cursor)
}

/** Models may include reasoning blocks, a title prefix, or surrounding quotes. */
export function extractTitle(raw: string): string {
  const line = stripReasoningBlocks(raw)
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.length > 0) ?? ''

  return line
    .replace(/^(title|chat title)\s*[:\-–]\s*/i, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .trim()
}
