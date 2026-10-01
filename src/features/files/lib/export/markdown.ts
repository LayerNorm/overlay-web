export function chatMessagesToMarkdown(
  messages: Array<{ role: string; content: string; parts?: Array<{ type: string; text?: string }> }>,
): string {
  return messages
    .map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant'
      let content = msg.content

      if (!content && msg.parts) {
        content = msg.parts.filter((p) => p.type === 'text').map((p) => p.text).join('')
      }

      return `### ${role}\n\n${content}\n`
    })
    .join('\n---\n\n')
}
