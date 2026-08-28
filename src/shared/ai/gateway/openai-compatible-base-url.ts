export const DEFAULT_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1'

/** OpenAI-compatible clients append `/chat/completions` themselves. */
export function normalizeOpenAiCompatibleBaseUrl(
  configuredUrl?: string,
  fallback = DEFAULT_AI_GATEWAY_BASE_URL,
): string {
  const normalized = (configuredUrl?.trim() || fallback).replace(/\/+$/, '')
  return normalized.replace(/\/chat\/completions$/i, '')
}
