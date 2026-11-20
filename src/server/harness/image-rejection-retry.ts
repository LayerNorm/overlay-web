import type { LanguageModelV4CallOptions, LanguageModelV4Prompt } from '@ai-sdk/provider'
import { readErrorField } from './ai-sdk-failure'

const REMOVED_IMAGE_NOTE = '[An image this tool returned was removed: the model provider rejected the request that carried it, '
  + 'so you cannot see it. Keep going from text instead (page snapshots, transcripts, file contents), '
  + 'and tell the person if seeing the image matters.]'

type ContentItem = { type: string; mediaType?: string }

function isImage(item: ContentItem): boolean {
  return item.type !== 'text' && Boolean(item.mediaType?.startsWith('image/'))
}

/**
 * Replaces every image a tool returned (a screenshot, a generated picture) with a short note.
 * Images the person attached are left alone: removing those silently would change their request.
 */
export function withoutToolResultImages(prompt: LanguageModelV4Prompt): { prompt: LanguageModelV4Prompt; removed: number } {
  let removed = 0
  const next = prompt.map((message) => {
    if (message.role !== 'tool') return message
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== 'tool-result' || part.output.type !== 'content') return part
        const items = part.output.value as ContentItem[]
        if (!items.some(isImage)) return part
        return {
          ...part,
          output: {
            ...part.output,
            value: items.map((item) => {
              if (!isImage(item)) return item
              removed += 1
              return { type: 'text' as const, text: REMOVED_IMAGE_NOTE }
            }),
          },
        }
      }),
    }
  }) as LanguageModelV4Prompt
  return { prompt: next, removed }
}

/** The provider refused the request itself (invalid or too large) before producing anything. */
function isRequestRejection(error: unknown): boolean {
  if (readErrorField(error, 'name') !== 'AI_APICallError') return false
  const status = readErrorField(error, 'statusCode')
  return status === 400 || status === 413
}

/**
 * A model connection can refuse a request because of an image a tool returned (too large, a format it does
 * not take). That used to end the run. Send the request once more without those images, so the agent carries
 * on and can say what it could not see. Any other failure, or a request with no tool images, is rethrown.
 */
export async function retryWithoutToolImages<T>(
  options: LanguageModelV4CallOptions,
  call: (options: LanguageModelV4CallOptions) => PromiseLike<T>,
  onRetry: (detail: { removed: number; status: unknown }) => void = () => {},
): Promise<T> {
  try {
    return await call(options)
  } catch (error) {
    if (!isRequestRejection(error)) throw error
    const { prompt, removed } = withoutToolResultImages(options.prompt)
    if (removed === 0) throw error
    onRetry({ removed, status: readErrorField(error, 'statusCode') })
    return await call({ ...options, prompt })
  }
}
