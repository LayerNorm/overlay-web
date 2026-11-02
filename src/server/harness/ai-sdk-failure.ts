// Keep this dependency-free: Workflow errors lose SDK prototypes and symbols in transit.
// Never include SDK messages or payloads, which can embed prompts and generated content.
const descriptions: Readonly<Record<string, string>> = {
  AI_APICallError: 'The request to the model provider failed.',
  AI_DownloadError: 'A file needed for the model request could not be downloaded. Check that the file is accessible.',
  AI_EmptyResponseBodyError: 'The model provider returned an empty response body.',
  AI_InvalidPromptError: 'The AI SDK could not accept the prompt or conversation format.',
  AI_InvalidResponseDataError: 'The model provider returned data in an unexpected format.',
  AI_JSONParseError: 'The AI SDK could not parse the returned data as valid JSON.',
  AI_LoadAPIKeyError: 'The model provider API key is missing or could not be loaded. Check the provider configuration.',
  AI_LoadSettingError: 'A required model provider setting is missing or could not be loaded. Check the provider configuration.',
  AI_NoContentGeneratedError: 'The model returned no content.',
  AI_NoSuchModelError: 'The configured model could not be found. Check the model selection and provider configuration.',
  AI_NoSuchProviderReferenceError: 'The configured provider reference could not be resolved. Check the provider configuration.',
  AI_RetryError: 'The model request could not complete within the AI SDK retry policy.',
  AI_StreamProviderError: 'The model provider reported an error while streaming the response.',
  AI_TooManyEmbeddingValuesForCallError: 'The embedding request contains more values than the model supports in one call. Use a smaller batch.',
  AI_TypeValidationError: 'The AI SDK received data that does not match the expected schema.',
  AI_UnsupportedFunctionalityError: 'The selected model or provider does not support the requested feature.',
  AI_InvalidArgumentError: 'An AI SDK call received an invalid argument. The request configuration needs correction.',
  AI_InvalidDataContentError: 'A message contains invalid image, audio, file, or other data content. Check the supplied attachments.',
  AI_InvalidMessageRoleError: 'The conversation contains a message role the AI SDK cannot accept.',
  AI_InvalidStreamPartError: 'The response stream contains an invalid data chunk.',
  AI_MessageConversionError: 'The AI SDK could not convert the conversation into model messages.',
  AI_UIMessageStreamError: 'The response stream could not be assembled into a valid chat message.',
  AI_NoImageGeneratedError: 'The model did not generate an image.',
  AI_NoObjectGeneratedError: 'The model did not generate structured output matching the requested schema.',
  AI_NoOutputGeneratedError: 'The model did not generate the requested output.',
  AI_NoSpeechGeneratedError: 'The model did not generate speech audio.',
  AI_NoTranscriptGeneratedError: 'The model did not generate a transcript.',
  AI_NoTranslationGeneratedError: 'The model did not generate a translation.',
  AI_NoVideoGeneratedError: 'The model did not generate a video.',
  AI_NoSuchProviderError: 'The configured model provider could not be found. Check the provider configuration.',
  AI_UnsupportedModelVersionError: 'The model adapter uses a specification version this AI SDK does not support. Check the adapter and SDK versions.',
  AI_InvalidToolApprovalError: 'A tool approval refers to an approval request missing from the conversation.',
  AI_InvalidToolApprovalSignatureError: 'A tool approval signature could not be verified. The approval cannot be trusted.',
  AI_InvalidToolInputError: 'The model supplied tool inputs that do not match the tool schema.',
  AI_MissingToolResultsError: 'The conversation is missing results for earlier tool calls. Tool state must be reconciled before continuing.',
  AI_NoSuchToolError: 'The model requested a tool that is not available to this agent.',
  AI_ToolCallNotFoundForApprovalError: 'A tool approval refers to a tool call missing from the conversation.',
  AI_ToolCallRepairError: 'The AI SDK could not repair an invalid tool call.',
  AI_ToolChoiceViolationError: 'The model response did not follow the required tool-use choice.',
}

export const PROVIDER_CONTENT_FILTER_REASON = 'The model provider blocked this response with its content filter (data_inspection_failed). Any partial response is incomplete.'

export function readErrorField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  try {
    return (value as Record<string, unknown>)[key]
  } catch (_error) {
    return undefined
  }
}

function requestFailure(status: number | undefined): string | undefined {
  switch (status) {
    case 400: return 'The model provider rejected the request as invalid.'
    case 401: return 'The model provider rejected authentication. Check the provider credentials.'
    case 402: return 'The model provider requires payment or credits. Check provider billing.'
    case 403: return 'The model provider denied access to the requested resource. Check provider permissions.'
    case 404: return 'The requested model or provider endpoint was not found. Check the model configuration.'
    case 408:
    case 504: return 'The model provider request timed out.'
    case 413: return 'The model provider rejected the request because it was too large. Reduce the request size.'
    case 429: return 'The model provider rate limit or quota was exceeded. Check provider limits before trying again.'
    default: return status !== undefined && status >= 500 ? 'The model provider encountered a server error.' : undefined
  }
}

function retryFailure(reason: unknown): string | undefined {
  switch (reason) {
    case 'maxRetriesExceeded': return 'The model request still failed after the AI SDK exhausted its retries.'
    case 'errorNotRetryable': return 'The AI SDK stopped because the last request error was not retryable.'
    case 'abort': return 'The AI SDK retry operation was aborted.'
    default: return undefined
  }
}

export function describeAISDKFailure(error: object): string | undefined {
  const name = readErrorField(error, 'name')
  if (typeof name !== 'string' || !/^AI_[A-Za-z][A-Za-z0-9]{0,70}Error$/.test(name)) return undefined
  const providerError = name === 'AI_TypeValidationError'
    ? readErrorField(readErrorField(error, 'value'), 'error')
    : name === 'AI_APICallError' || name === 'AI_StreamProviderError'
      ? readErrorField(readErrorField(error, 'data'), 'error')
      : undefined
  if (readErrorField(providerError, 'code') === 'data_inspection_failed'
    || (name === 'AI_StreamProviderError' && readErrorField(error, 'code') === 'data_inspection_failed')) {
    return PROVIDER_CONTENT_FILTER_REASON
  }
  const rawStatus = readErrorField(error, 'statusCode')
  const status = ['AI_APICallError', 'AI_StreamProviderError', 'AI_DownloadError'].includes(name)
    && typeof rawStatus === 'number' && Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus : undefined
  const requestReason = name === 'AI_APICallError' || name === 'AI_StreamProviderError' ? requestFailure(status) : undefined
  const retryReason = name === 'AI_RetryError' ? retryFailure(readErrorField(error, 'reason')) : undefined
  const description = requestReason ?? retryReason ?? descriptions[name]
    ?? 'The AI SDK could not complete this operation. Share this error type with support.'
  const partial = name === 'AI_StreamProviderError' || name === 'AI_UIMessageStreamError' || name === 'AI_InvalidStreamPartError'
    ? ' Any partial response is incomplete.' : ''
  return `${description}${partial} (${name}${status === undefined ? '' : `, HTTP ${status}`})`
}
