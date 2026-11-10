import type { LanguageModelV4Prompt, LanguageModelV4ToolResultPart } from '@ai-sdk/provider'

/**
 * Subscription connections accept text and images. The request check still rejects
 * other files (PDFs, audio, video), and a tool can return one that then stays in the
 * conversation history. Replace each such file with a short note so the run continues
 * and the model knows it could not see the file, instead of every later request failing.
 */
export function withoutUnsupportedSubscriptionFiles(prompt: LanguageModelV4Prompt): LanguageModelV4Prompt {
  return prompt.map((message) => {
    if (message.role === 'system') return message
    return {
      ...message,
      content: (message.content as Array<{ type: string; mediaType?: string }>).map(supportedPart),
    }
  }) as LanguageModelV4Prompt
}

function isImage(mediaType: string | undefined): boolean {
  return Boolean(mediaType?.startsWith('image/'))
}

function supportedPart<T extends { type: string; mediaType?: string }>(part: T) {
  if ((part.type === 'file' || part.type === 'reasoning-file') && !isImage(part.mediaType)) {
    return { type: 'text' as const, text: omittedFileNote(part.mediaType) }
  }
  if (part.type === 'tool-result') {
    const result = part as unknown as LanguageModelV4ToolResultPart
    const supported = (item: (typeof result.output & { type: 'content' })['value'][number]) =>
      item.type === 'text' || ('mediaType' in item && isImage(item.mediaType))
    if (result.output.type !== 'content' || result.output.value.every(supported)) return part
    return {
      ...result,
      output: {
        ...result.output,
        value: result.output.value.map((item) => supported(item)
          ? item
          : { type: 'text' as const, text: omittedFileNote('mediaType' in item ? item.mediaType : undefined) }),
      },
    }
  }
  return part
}

function omittedFileNote(mediaType: string | undefined): string {
  return `[A file${mediaType ? ` (${mediaType})` : ''} was omitted: this model connection accepts only text and images, so you cannot see it. Tell the person if you need its contents.]`
}
