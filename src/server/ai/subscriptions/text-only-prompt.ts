import type { LanguageModelV4Prompt, LanguageModelV4ToolResultPart } from '@ai-sdk/provider'

/**
 * Subscription connections accept text only, and the request check rejects any
 * image or file part. A tool can still return an image (for example a fetched
 * screenshot), and that image stays in the conversation history. Replace each
 * file part with a short note so the run continues and the model knows it could
 * not see the file, instead of every later request failing.
 */
export function textOnlySubscriptionPrompt(prompt: LanguageModelV4Prompt): LanguageModelV4Prompt {
  return prompt.map((message) => {
    if (message.role === 'system') return message
    return {
      ...message,
      content: (message.content as Array<{ type: string; mediaType?: string }>).map(textOnlyPart),
    }
  }) as LanguageModelV4Prompt
}

function textOnlyPart<T extends { type: string; mediaType?: string }>(part: T) {
  if (part.type === 'file' || part.type === 'reasoning-file') {
    return { type: 'text' as const, text: omittedFileNote(part.mediaType) }
  }
  if (part.type === 'tool-result') {
    const result = part as unknown as LanguageModelV4ToolResultPart
    if (result.output.type !== 'content' || result.output.value.every((item) => item.type === 'text')) return part
    return {
      ...result,
      output: {
        ...result.output,
        value: result.output.value.map((item) => item.type === 'text'
          ? item
          : { type: 'text' as const, text: omittedFileNote('mediaType' in item ? item.mediaType : undefined) }),
      },
    }
  }
  return part
}

function omittedFileNote(mediaType: string | undefined): string {
  const kind = mediaType?.startsWith('image/') ? 'An image' : 'A file'
  return `[${kind}${mediaType ? ` (${mediaType})` : ''} was omitted: this model connection accepts text only, so you cannot see it. Tell the person if you need its contents.]`
}
