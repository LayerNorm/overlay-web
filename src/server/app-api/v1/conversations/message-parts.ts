/** Use legacy content when structured parts have no body, retaining run status and other metadata. */
export function conversationMessageParts(input: {content: string; parts?: Array<Record<string, unknown>>}): Array<Record<string, unknown>> {
  const parts = input.parts ?? []
  const hasBody = parts.some(part => {
    const type = typeof part.type === 'string' ? part.type : ''
    if (['text', 'output-text', 'reasoning'].includes(type)) return typeof part.text === 'string' && part.text.trim().length > 0
    return ['tool-invocation', 'file', 'data'].includes(type) || type.startsWith('tool-')
  })
  if (hasBody) return parts
  return [{type: 'text', text: input.content}, ...parts.filter(part => !['text', 'output-text', 'reasoning'].includes(String(part.type)))]
}
