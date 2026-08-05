import 'server-only'

import { uploadFile, type ProviderReference } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createXai } from '@ai-sdk/xai'
import { getModel } from '@/shared/ai/gateway/model-data'

/**
 * v7 file upload: uploads file data to the model's provider and returns a
 * `ProviderReference` that can be used in place of an inline data URL.
 *
 * Falls back to `null` when:
 * - The provider doesn't support file uploads
 * - No direct API key is configured for the provider
 * - The upload fails for any reason
 *
 * The caller should keep the inline URL when this returns `null`.
 */
export async function tryUploadFileToProvider(args: {
  modelId: string
  url: string
  mediaType: string
  fileName?: string
}): Promise<{ providerReference: ProviderReference } | null> {
  const { modelId, url, mediaType, fileName } = args
  const model = getModel(modelId)
  if (!model) return null

  // Only attempt for providers that support file upload APIs.
  const provider = model.provider
  if (!['openai', 'anthropic', 'google', 'xai'].includes(provider)) return null

  // Only upload image files for now — other media types may not be supported.
  if (!mediaType.startsWith('image/')) return null

  try {
    // Fetch the file data from the URL (could be a data: URL or https: URL).
    const response = await fetch(url)
    if (!response.ok) return null
    const data = new Uint8Array(await response.arrayBuffer())

    const filesApi = resolveProviderFilesApi(provider)
    if (!filesApi) return null

    const result = await uploadFile({
      api: filesApi,
      data,
      filename: fileName ?? 'upload',
    })

    if (result.providerReference) {
      return { providerReference: result.providerReference }
    }
    return null
  } catch {
    // Upload failed — fall back to inline.
    return null
  }
}

function resolveProviderFilesApi(provider: string): ReturnType<ReturnType<typeof createOpenAI>['files']> | null {
  switch (provider) {
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) return null
      return createOpenAI({ apiKey }).files()
    }
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) return null
      return createAnthropic({ apiKey }).files()
    }
    case 'google': {
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY
      if (!apiKey) return null
      return createGoogleGenerativeAI({ apiKey }).files()
    }
    case 'xai': {
      const apiKey = process.env.XAI_API_KEY
      if (!apiKey) return null
      return createXai({ apiKey }).files()
    }
    default:
      return null
  }
}

/**
 * Processes UIMessage file parts, uploading eligible files to the model's provider
 * and adding provider references. Mutates messages in place.
 *
 * Only processes user messages with file parts that have URLs (data: or https:).
 * Files already using provider references are left as-is.
 */
export async function uploadFilePartsForModel(
  messages: Array<{
    role: string
    parts?: Array<{
      type: string
      url?: string
      mediaType?: string
      fileName?: string
      filename?: string
      providerReference?: ProviderReference
    }>
  }>,
  modelId: string,
): Promise<void> {
  for (const message of messages) {
    if (message.role !== 'user' || !message.parts) continue
    for (const part of message.parts) {
      if (part.type !== 'file' || !part.url || !part.mediaType || part.providerReference) continue
      // Skip data: URLs that are small (< 100KB) — inline is cheaper for small files.
      if (part.url.startsWith('data:') && part.url.length < 100_000) continue

      const result = await tryUploadFileToProvider({
        modelId,
        url: part.url,
        mediaType: part.mediaType,
        fileName: part.fileName ?? part.filename,
      })
      if (result) {
        // AI SDK v7 reads provider references from this dedicated field.
        // Keep the original URL as a fallback for providers that do not use it.
        part.providerReference = result.providerReference
      }
    }
  }
}
