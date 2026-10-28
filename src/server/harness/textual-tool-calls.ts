function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isToolCall(value: unknown, toolNames: ReadonlySet<string>): boolean {
  if (!isRecord(value) || typeof value.name !== 'string' || !toolNames.has(value.name)) return false
  return isRecord(value.parameters) || isRecord(value.arguments)
}

function isToolCallJson(segment: string, toolNames: ReadonlySet<string>): boolean {
  try {
    const value: unknown = JSON.parse(segment)
    if (Array.isArray(value)) return value.length > 0 && value.every(item => isToolCall(item, toolNames))
    return isToolCall(value, toolNames)
  } catch (_error) {
    return false
  }
}

function stripFencedToolCalls(text: string, toolNames: ReadonlySet<string>): string {
  return text.replace(/```[^\n]*\n([\s\S]*?)\n```/g, (block, body: string) => (
    isToolCallJson(body.trim(), toolNames) ? '' : block
  ))
}

function stripStandaloneToolCalls(text: string, toolNames: ReadonlySet<string>): string {
  return text.split(/\n[ \t]*\n+/).flatMap(paragraph => {
    if (isToolCallJson(paragraph.trim(), toolNames)) return []
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
