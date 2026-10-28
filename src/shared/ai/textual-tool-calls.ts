function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isToolCall(value: unknown, toolNames: ReadonlySet<string>): boolean {
  if (!isRecord(value) || typeof value.name !== 'string' || !toolNames.has(value.name)) return false
  return isRecord(value.parameters) || isRecord(value.arguments)
}

function isToolCallOrArray(value: unknown, toolNames: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.every(item => isToolCallOrArray(item, toolNames))
  return isToolCall(value, toolNames)
}

function isToolCallJson(segment: string, toolNames: ReadonlySet<string>): boolean {
  try {
    return isToolCallOrArray(JSON.parse(segment) as unknown, toolNames)
  } catch {
    return false
  }
}

function startsWithKnownToolCall(segment: string, toolNames: ReadonlySet<string>): boolean {
  const match = segment.match(/^[\s\[]*\{\s*"name"\s*:\s*"([^"]+)"/)
  return match !== null && toolNames.has(match[1]!)
}

function stripFencedToolCalls(text: string, toolNames: ReadonlySet<string>): string {
  return text.replace(/```[^\n]*\n([\s\S]*?)\n```/g, (block, body: string) => (
    isToolCallJson(body.trim(), toolNames) || startsWithKnownToolCall(body.trim(), toolNames) ? '' : block
  ))
}

function stripStandaloneToolCalls(text: string, toolNames: ReadonlySet<string>): string {
  return text.split(/\n[ \t]*\n+/).flatMap(paragraph => {
    if (isToolCallJson(paragraph.trim(), toolNames) || startsWithKnownToolCall(paragraph.trim(), toolNames)) return []
    return paragraph.split('\n').filter(line => !isToolCallJson(line.trim(), toolNames)).join('\n')
  }).join('\n\n')
}

export function stripTextualToolCalls(text: string, toolNames: ReadonlySet<string>): string {
  const withoutProtocol = text
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/g, '')
    .replace(/<\|python_tag\|>[\s\S]*$/g, '')
    .replace(/\r\n?/g, '\n')
  const withoutJson = stripStandaloneToolCalls(stripFencedToolCalls(withoutProtocol, toolNames), toolNames)
  return withoutJson.replace(/\n[ \t]*\n(?:[ \t]*\n)*/g, '\n\n').trim()
}

export function stripTextualToolCallsFromParts<T extends Record<string, unknown>>(
  parts: readonly T[],
  toolNames: ReadonlySet<string>,
): T[] {
  return parts.flatMap(part => {
    if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') return [part]
    const text = stripTextualToolCalls(part.text, toolNames)
    return text ? [{ ...part, text } as T] : []
  })
}
