import { generatedUiDeliveryText } from '@overlay/chat-core/generated-ui'

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

      const rendered = generatedUiDeliveryText(content, msg.parts)
      const hasTextParts = msg.parts?.some(part => part.type === 'text' && part.text?.trim())
      content = !hasTextParts && content && rendered !== content ? `${rendered}\n\n${content}` : rendered

      return `### ${role}\n\n${content}\n`
    })
    .join('\n---\n\n')
}
