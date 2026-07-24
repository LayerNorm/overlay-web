/**
 * Unified error handling for all AI providers
 * Provides consistent error types, parsing, and user-friendly messages
 */

// ── Error Codes ────────────────────────────────────────────────────────────────

export enum AIErrorCode {
  // Auth errors (4xx)
  INVALID_API_KEY = 'invalid_api_key',
  PERMISSION_DENIED = 'permission_denied',
  INSUFFICIENT_CREDITS = 'insufficient_credits',

  // Rate limiting
  RATE_LIMITED = 'rate_limited',
  QUOTA_EXCEEDED = 'quota_exceeded',

  // Request errors
  INVALID_REQUEST = 'invalid_request',
  CONTEXT_TOO_LONG = 'context_too_long',
  TOOL_CALLING_UNSUPPORTED = 'tool_calling_unsupported',
  INVALID_TOOL_INPUT = 'invalid_tool_input',

  // Server errors
  PROVIDER_ERROR = 'provider_error',
  MODEL_UNAVAILABLE = 'model_unavailable',
  OVERLOADED = 'overloaded',

  // Network errors
  TIMEOUT = 'timeout',
  NETWORK_ERROR = 'network_error',

  // Unknown
  UNKNOWN = 'unknown'
}

export interface AIError {
  code: AIErrorCode
  message: string
  provider: string
  httpStatus?: number
  retryable: boolean
  retryAfterMs?: number
  rawError?: unknown
}

// ── Provider-Specific Parsers ──────────────────────────────────────────────────

function parseOpenRouterError(error: unknown, provider: string): AIError {
  const errorObj = error as {
    status?: number
    message?: string
    error?: { code?: string; message?: string }
    data?: { error?: { code?: string; message?: string } }
  }

  // Extract error message
  let message =
    errorObj.message || errorObj.error?.message || errorObj.data?.error?.message || String(error)

  // Parse HTTP status from error message if present (e.g., "HTTP 400: {...}")
  let status = errorObj.status
  const httpMatch = message.match(/^HTTP\s+(\d+):\s*(.*)$/s)
  if (httpMatch) {
    status = parseInt(httpMatch[1], 10)
    message = httpMatch[2] // Use the JSON part of the message
  }

  const code = errorObj.error?.code || errorObj.data?.error?.code

  // Map OpenRouter error codes
  if (status === 400 || code === 'invalid_prompt') {
    // Check for provider-specific validation errors (e.g., missing arguments field)
    if (
      message.includes('Provider returned error') ||
      message.includes('arguments is required') ||
      message.includes('validation error')
    ) {
      return {
        code: AIErrorCode.PROVIDER_ERROR,
        message: 'The AI provider encountered an issue processing tool calls. Trying a different approach...',
        provider,
        httpStatus: status,
        retryable: true, // These are often transient or model-specific
        retryAfterMs: 500,
        rawError: error
      }
    }
    return {
      code: AIErrorCode.INVALID_REQUEST,
      message,
      provider,
      httpStatus: status,
      retryable: false,
      rawError: error
    }
  }

  if (status === 401) {
    return {
      code: AIErrorCode.INVALID_API_KEY,
      message: 'Invalid OpenRouter API key',
      provider,
      httpStatus: 401,
      retryable: false,
      rawError: error
    }
  }

  if (status === 402) {
    return {
      code: AIErrorCode.INSUFFICIENT_CREDITS,
      message: 'Insufficient OpenRouter credits',
      provider,
      httpStatus: 402,
      retryable: false,
      rawError: error
    }
  }

  if (status === 403) {
    return {
      code: AIErrorCode.PERMISSION_DENIED,
      message: 'Content moderation flagged or permission denied',
      provider,
      httpStatus: 403,
      retryable: false,
      rawError: error
    }
  }

  if (status === 429) {
    return {
      code: AIErrorCode.RATE_LIMITED,
      message: 'Rate limited by OpenRouter',
      provider,
      httpStatus: 429,
      retryable: true,
      retryAfterMs: 2000,
      rawError: error
    }
  }

  if (status === 502 || status === 503) {
    return {
      code: AIErrorCode.PROVIDER_ERROR,
      message: 'Upstream provider error',
      provider,
      httpStatus: status,
      retryable: true,
      retryAfterMs: 1000,
      rawError: error
    }
  }

  // Context length errors
  if (
    message.toLowerCase().includes('context') ||
    message.toLowerCase().includes('token') ||
    message.toLowerCase().includes('too long')
  ) {
    return {
      code: AIErrorCode.CONTEXT_TOO_LONG,
      message: 'Context window exceeded',
      provider,
      httpStatus: status,
      retryable: false,
      rawError: error
    }
  }

  return {
    code: AIErrorCode.UNKNOWN,
    message,
    provider,
    httpStatus: status,
    retryable: false,
    rawError: error
  }
}

function parseGroqError(error: unknown, provider: string): AIError {
  const errorObj = error as {
    status?: number
    message?: string
    error?: { type?: string; message?: string }
  }

  const status = errorObj.status
  const message = errorObj.message || errorObj.error?.message || String(error)
  const type = errorObj.error?.type

  if (status === 400 || type === 'invalid_request_error') {
    return {
      code: AIErrorCode.INVALID_REQUEST,
      message,
      provider,
      httpStatus: 400,
      retryable: false,
      rawError: error
    }
  }

  if (status === 401) {
    return {
      code: AIErrorCode.INVALID_API_KEY,
      message: 'Invalid Groq API key',
      provider,
      httpStatus: 401,
      retryable: false,
      rawError: error
    }
  }

  if (status === 422) {
    // Model hallucination - retryable
    return {
      code: AIErrorCode.INVALID_REQUEST,
      message: 'Model output error (retrying may help)',
      provider,
      httpStatus: 422,
      retryable: true,
      retryAfterMs: 500,
      rawError: error
    }
  }

  if (status === 429) {
    return {
      code: AIErrorCode.RATE_LIMITED,
      message: 'Rate limited by Groq',
      provider,
      httpStatus: 429,
      retryable: true,
      retryAfterMs: 2000,
      rawError: error
    }
  }

  if (status === 498) {
    // Flex tier capacity
    return {
      code: AIErrorCode.OVERLOADED,
      message: 'Groq Flex tier at capacity',
      provider,
      httpStatus: 498,
      retryable: true,
      retryAfterMs: 5000,
      rawError: error
    }
  }

  if (status && status >= 500) {
    return {
      code: AIErrorCode.PROVIDER_ERROR,
      message: 'Groq server error',
      provider,
      httpStatus: status,
      retryable: true,
      retryAfterMs: 1000,
      rawError: error
    }
  }

  return {
    code: AIErrorCode.UNKNOWN,
    message,
    provider,
    httpStatus: status,
    retryable: false,
    rawError: error
  }
}

function parseAnthropicError(error: unknown, provider: string): AIError {
  const errorObj = error as {
    status?: number
    message?: string
    error?: { type?: string; message?: string }
  }

  const status = errorObj.status
  const message = errorObj.message || errorObj.error?.message || String(error)
  const type = errorObj.error?.type

  if (type === 'invalid_request_error') {
    return {
      code: AIErrorCode.INVALID_REQUEST,
      message,
      provider,
      httpStatus: 400,
      retryable: false,
      rawError: error
    }
  }

  if (type === 'authentication_error' || status === 401) {
    return {
      code: AIErrorCode.INVALID_API_KEY,
      message: 'Invalid Anthropic API key',
      provider,
      httpStatus: 401,
      retryable: false,
      rawError: error
    }
  }

  if (type === 'permission_error') {
    return {
      code: AIErrorCode.PERMISSION_DENIED,
      message: 'Permission denied',
      provider,
      httpStatus: 403,
      retryable: false,
      rawError: error
    }
  }

  if (type === 'rate_limit_error' || status === 429) {
    return {
      code: AIErrorCode.RATE_LIMITED,
      message: 'Rate limited by Anthropic',
      provider,
      httpStatus: 429,
      retryable: true,
      retryAfterMs: 2000,
      rawError: error
    }
  }

  if (type === 'overloaded_error' || status === 529) {
    return {
      code: AIErrorCode.OVERLOADED,
      message: 'Anthropic API overloaded',
      provider,
      httpStatus: 529,
      retryable: true,
      retryAfterMs: 5000,
      rawError: error
    }
  }

  if (type === 'api_error' || (status && status >= 500)) {
    return {
      code: AIErrorCode.PROVIDER_ERROR,
      message: 'Anthropic server error',
      provider,
      httpStatus: status || 500,
      retryable: true,
      retryAfterMs: 1000,
      rawError: error
    }
  }

  return {
    code: AIErrorCode.UNKNOWN,
    message,
    provider,
    httpStatus: status,
    retryable: false,
    rawError: error
  }
}

function parseAISDKError(error: unknown, provider: string): AIError {
  const errorObj = error as {
    name?: string
    message?: string
    status?: number
    data?: unknown
    cause?: unknown
  }

  const name = errorObj.name || ''
  const message = errorObj.message || String(error)
  const status = errorObj.status

  // Check for AI SDK error types
  if (name === 'AI_APICallError') {
    // Parse the underlying error
    if (message.includes('Invalid Responses API')) {
      return {
        code: AIErrorCode.INVALID_REQUEST,
        message: 'API format incompatibility - switching to direct SDK',
        provider,
        httpStatus: status,
        retryable: false,
        rawError: error
      }
    }

    if (status === 429 || message.toLowerCase().includes('rate limit')) {
      return {
        code: AIErrorCode.RATE_LIMITED,
        message: 'Rate limited',
        provider,
        httpStatus: 429,
        retryable: true,
        retryAfterMs: 2000,
        rawError: error
      }
    }

    if (status === 401) {
      return {
        code: AIErrorCode.INVALID_API_KEY,
        message: 'Invalid API key',
        provider,
        httpStatus: 401,
        retryable: false,
        rawError: error
      }
    }
  }

  if (name === 'AI_InvalidToolInputError') {
    return {
      code: AIErrorCode.INVALID_TOOL_INPUT,
      message: 'Invalid tool input',
      provider,
      retryable: false,
      rawError: error
    }
  }

  if (name === 'AI_UnsupportedFunctionalityError') {
    if (message.toLowerCase().includes('tool')) {
      return {
        code: AIErrorCode.TOOL_CALLING_UNSUPPORTED,
        message: 'Tool calling not supported by this model',
        provider,
        retryable: false,
        rawError: error
      }
    }
  }

  if (name === 'AI_RetryError') {
    return {
      code: AIErrorCode.PROVIDER_ERROR,
      message: 'Request failed after retries',
      provider,
      retryable: false,
      rawError: error
    }
  }

  return {
    code: AIErrorCode.UNKNOWN,
    message,
    provider,
    httpStatus: status,
    retryable: false,
    rawError: error
  }
}

function parseGenericError(error: unknown, provider: string): AIError {
  const message = error instanceof Error ? error.message : String(error)

  // Check for common patterns
  if (
    message.toLowerCase().includes('timeout') ||
    message.toLowerCase().includes('timed out')
  ) {
    return {
      code: AIErrorCode.TIMEOUT,
      message: 'Request timed out',
      provider,
      retryable: true,
      retryAfterMs: 1000,
      rawError: error
    }
  }

  if (
    message.toLowerCase().includes('network') ||
    message.toLowerCase().includes('econnrefused') ||
    message.toLowerCase().includes('enotfound')
  ) {
    return {
      code: AIErrorCode.NETWORK_ERROR,
      message: 'Network error',
      provider,
      retryable: true,
      retryAfterMs: 1000,
      rawError: error
    }
  }

  if (
    message.toLowerCase().includes('context') ||
    message.toLowerCase().includes('token limit') ||
    message.toLowerCase().includes('too long')
  ) {
    return {
      code: AIErrorCode.CONTEXT_TOO_LONG,
      message: 'Context window exceeded',
      provider,
      retryable: false,
      rawError: error
    }
  }

  return {
    code: AIErrorCode.UNKNOWN,
    message,
    provider,
    retryable: false,
    rawError: error
  }
}

// ── Main Parser ────────────────────────────────────────────────────────────────

function isAISDKError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const err = error as Record<string | symbol, unknown>
  return (
    err[Symbol.for('vercel.ai.error')] === true ||
    (typeof err.name === 'string' && err.name.startsWith('AI_'))
  )
}

export function parseProviderError(error: unknown, provider: string): AIError {
  // First check if it's an AI SDK error
  if (isAISDKError(error)) {
    return parseAISDKError(error, provider)
  }

  // Then try provider-specific parsing
  switch (provider) {
    case 'openrouter':
      return parseOpenRouterError(error, provider)
    case 'groq':
      return parseGroqError(error, provider)
    case 'anthropic':
      return parseAnthropicError(error, provider)
    default:
      return parseGenericError(error, provider)
  }
}

// ── User-Friendly Messages ─────────────────────────────────────────────────────

export function getUserFriendlyMessage(error: AIError): string {
  switch (error.code) {
    case AIErrorCode.INVALID_API_KEY:
      return `Invalid ${error.provider} API key. Please check your settings.`

    case AIErrorCode.PERMISSION_DENIED:
      return 'Permission denied. The request may have been flagged by content moderation.'

    case AIErrorCode.INSUFFICIENT_CREDITS:
      return `Insufficient ${error.provider} credits. Please add credits to continue.`

    case AIErrorCode.RATE_LIMITED:
      return 'Rate limited. Retrying in a moment...'

    case AIErrorCode.QUOTA_EXCEEDED:
      return 'Quota exceeded. Please try again later or upgrade your plan.'

    case AIErrorCode.INVALID_REQUEST:
      return 'Invalid request. Please try rephrasing your message.'

    case AIErrorCode.CONTEXT_TOO_LONG:
      return 'Conversation too long. Starting a new conversation may help.'

    case AIErrorCode.TOOL_CALLING_UNSUPPORTED:
      return 'This model does not support browser automation. Try using Claude or GPT-4.'

    case AIErrorCode.INVALID_TOOL_INPUT:
      return 'Tool input error. Please try again.'

    case AIErrorCode.PROVIDER_ERROR:
      return 'The AI service is experiencing issues. Retrying...'

    case AIErrorCode.MODEL_UNAVAILABLE:
      return 'This model is currently unavailable. Please try a different model.'

    case AIErrorCode.OVERLOADED:
      return 'The AI service is overloaded. Retrying in a moment...'

    case AIErrorCode.TIMEOUT:
      return 'Request timed out. Retrying...'

    case AIErrorCode.NETWORK_ERROR:
      return 'Network error. Please check your connection.'

    case AIErrorCode.UNKNOWN:
    default:
      return `Error: ${error.message.slice(0, 100)}`
  }
}

// ── Retry Logic ────────────────────────────────────────────────────────────────

export interface RetryDecision {
  retry: boolean
  delayMs: number
  reason?: string
}

export function shouldRetry(error: AIError, attemptNumber: number, maxRetries: number = 3): RetryDecision {
  if (attemptNumber >= maxRetries) {
    return { retry: false, delayMs: 0, reason: 'Max retries exceeded' }
  }

  if (!error.retryable) {
    return { retry: false, delayMs: 0, reason: 'Error is not retryable' }
  }

  // Calculate delay with exponential backoff
  const baseDelay = error.retryAfterMs || 1000
  const delay = baseDelay * Math.pow(2, attemptNumber)

  return {
    retry: true,
    delayMs: Math.min(delay, 30000), // Cap at 30 seconds
    reason: `Retrying (attempt ${attemptNumber + 1}/${maxRetries})`
  }
}
