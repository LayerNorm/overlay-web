import { runInNewContext } from 'node:vm'
import { APICallError, InvalidToolInputError, RetryError, StreamProviderError, TypeValidationError } from 'ai'
import { expect, test } from 'vitest'
import { harnessExecutionFailureReason, preserveHarnessSDKFailure } from './execution-failure'

test('preserves native, cross-realm and string errors', () => {
  expect(harnessExecutionFailureReason(new Error('Connection closed.'))).toBe('Connection closed.')
  expect(harnessExecutionFailureReason(runInNewContext('new Error("Connection closed.")'))).toBe('Connection closed.')
  expect(harnessExecutionFailureReason('Connection closed.')).toBe('Connection closed.')
})

test('preserves serialized Workflow codes and underlying causes without arbitrary metadata', () => {
  expect(harnessExecutionFailureReason({ name: 'WorkflowError', code: 'STREAM_ERROR',
    message: 'Step failed.', cause: { name: 'TypeError', message: 'Connection closed.' },
    request: { headers: { authorization: 'private-token' } }, stack: 'private-stack',
  })).toBe('WorkflowError / STREAM_ERROR: Step failed. Caused by: TypeError: Connection closed.')
})

test('redacts credentials before truncation', () => {
  const reason = harnessExecutionFailureReason({ message: 'Request failed: https://provider.test/?api_key=url-secret '
    + 'Bearer bearer-secret api_key="quoted secret" password=hidden sk-test1234567890 '
    + 'owner@example.test ' + 'x'.repeat(2_000), cause: new Error('Other failure') })
  for (const secret of ['url-secret', 'bearer-secret', 'quoted secret', 'hidden', 'sk-test1234567890', 'owner@example.test']) {
    expect(reason).not.toContain(secret)
  }
  expect(reason).toHaveLength(2_000)
  expect(reason).toContain('Request failed:')
})

test('reports a provider content-filter rejection wrapped in a serialized validation error', () => {
  const error = {
    name: 'AI_TypeValidationError',
    cause: { name: 'ZodError', message: 'Invalid input: expected array, received undefined at choices' },
    value: {
      error: { code: 'data_inspection_failed', type: 'data_inspection_failed',
        message: '<400> InternalError.Algo.DataInspectionFailed: Output data may contain inappropriate content.' },
      request_id: 'private-request-id',
      content: 'private-provider-content',
    },
  }
  const reason = 'The model provider blocked this response with its content filter (data_inspection_failed). Any partial response is incomplete.'
  expect(harnessExecutionFailureReason(error)).toBe(reason)
  expect(harnessExecutionFailureReason({ message: 'Stream failed.', cause: error })).toBe(reason)
  expect(harnessExecutionFailureReason({ ...error, value: { error: { code: 'another_error' } } }))
    .toBe('The AI SDK received data that does not match the expected schema. (AI_TypeValidationError)')
  expect(harnessExecutionFailureReason({ ...error, get value() { throw new Error('private'); } }))
    .toBe('The AI SDK received data that does not match the expected schema. (AI_TypeValidationError)')
})

test('normalization tolerates missing details, circular causes and throwing getters', () => {
  const circular: { message: string; cause?: unknown } = { message: 'Step failed.' }
  circular.cause = circular
  expect(harnessExecutionFailureReason(circular)).toBe('Step failed.')
  expect(harnessExecutionFailureReason({ get message() { throw new Error('private'); }, cause: 'Underlying failure.' }))
    .toBe('Underlying failure.')
  for (const error of [null, undefined, {}, false, 0]) {
    expect(harnessExecutionFailureReason(error)).toBe('Harness execution failed without error details.')
  }
})

test.each([
  ['AI_APICallError', 'request to the model provider failed'],
  ['AI_DownloadError', 'could not be downloaded'],
  ['AI_EmptyResponseBodyError', 'empty response body'],
  ['AI_InvalidPromptError', 'prompt or conversation format'],
  ['AI_InvalidResponseDataError', 'unexpected format'],
  ['AI_JSONParseError', 'valid JSON'],
  ['AI_LoadAPIKeyError', 'API key is missing'],
  ['AI_LoadSettingError', 'provider setting is missing'],
  ['AI_NoContentGeneratedError', 'no content'],
  ['AI_NoSuchModelError', 'model could not be found'],
  ['AI_NoSuchProviderReferenceError', 'provider reference could not be resolved'],
  ['AI_RetryError', 'AI SDK retry policy'],
  ['AI_StreamProviderError', 'while streaming'],
  ['AI_TooManyEmbeddingValuesForCallError', 'smaller batch'],
  ['AI_TypeValidationError', 'expected schema'],
  ['AI_UnsupportedFunctionalityError', 'does not support'],
  ['AI_InvalidArgumentError', 'invalid argument'],
  ['AI_InvalidDataContentError', 'invalid image, audio, file'],
  ['AI_InvalidMessageRoleError', 'message role'],
  ['AI_InvalidStreamPartError', 'invalid data chunk'],
  ['AI_MessageConversionError', 'convert the conversation'],
  ['AI_UIMessageStreamError', 'valid chat message'],
  ['AI_NoImageGeneratedError', 'did not generate an image'],
  ['AI_NoObjectGeneratedError', 'structured output matching'],
  ['AI_NoOutputGeneratedError', 'requested output'],
  ['AI_NoSpeechGeneratedError', 'speech audio'],
  ['AI_NoTranscriptGeneratedError', 'a transcript'],
  ['AI_NoTranslationGeneratedError', 'a translation'],
  ['AI_NoVideoGeneratedError', 'a video'],
  ['AI_NoSuchProviderError', 'provider could not be found'],
  ['AI_UnsupportedModelVersionError', 'specification version'],
  ['AI_InvalidToolApprovalError', 'approval request missing'],
  ['AI_InvalidToolApprovalSignatureError', 'signature could not be verified'],
  ['AI_InvalidToolInputError', 'tool inputs'],
  ['AI_MissingToolResultsError', 'missing results'],
  ['AI_NoSuchToolError', 'tool that is not available'],
  ['AI_ToolCallNotFoundForApprovalError', 'tool call missing'],
  ['AI_ToolCallRepairError', 'repair an invalid tool call'],
  ['AI_ToolChoiceViolationError', 'required tool-use choice'],
])('describes serialized %s without echoing private SDK messages or payloads', (name, detail) => {
  const privateText = 'private customer prompt and generated output'
  const reason = harnessExecutionFailureReason({ name, message: privateText,
    cause: { message: privateText }, value: privateText, data: privateText, toolInput: privateText,
    responseBody: privateText, requestBodyValues: privateText, responseHeaders: { authorization: privateText },
  })
  expect(reason).toContain(detail)
  expect(reason).toContain(`(${name})`)
  expect(reason).not.toContain(privateText)
})

test.each([
  [400, 'rejected the request as invalid'],
  [401, 'rejected authentication'],
  [402, 'requires payment or credits'],
  [403, 'denied access'],
  [404, 'was not found'],
  [408, 'timed out'],
  [413, 'too large'],
  [429, 'rate limit or quota'],
  [500, 'server error'],
  [503, 'server error'],
  [504, 'timed out'],
  [422, 'request to the model provider failed'],
])('describes provider HTTP %s without inferring a retry', (statusCode, detail) => {
  const error = new APICallError({ message: 'private provider response', url: 'https://private.test',
    requestBodyValues: { prompt: 'private prompt' }, statusCode, isRetryable: true })
  const reason = harnessExecutionFailureReason(error)
  expect(reason).toContain(detail)
  expect(reason).toContain(`HTTP ${statusCode}`)
  expect(reason).not.toContain('private')
  expect(harnessExecutionFailureReason({ name: error.name, statusCode, isRetryable: false })).toBe(reason)
})

test('handles native SDK retries and cross-realm errors without reading their raw messages', () => {
  const lastError = new APICallError({ message: 'private', url: 'https://private.test', requestBodyValues: {}, statusCode: 429 })
  const error = new RetryError({ message: 'private', reason: 'maxRetriesExceeded', errors: [lastError] })
  const reason = harnessExecutionFailureReason(error)
  expect(reason).toBe('The model request still failed after the AI SDK exhausted its retries. (AI_RetryError)'
    + ' Caused by: The model provider rate limit or quota was exceeded. Check provider limits before trying again. (AI_APICallError, HTTP 429)')
  expect(harnessExecutionFailureReason({ message: 'private wrapper', cause: error })).toBe(reason)
  expect(harnessExecutionFailureReason(runInNewContext('Object.assign(new Error("private"), {name:"AI_APICallError",statusCode:429})')))
    .toBe(harnessExecutionFailureReason(lastError))
  expect(harnessExecutionFailureReason({ name: 'AI_RetryError', reason: 'errorNotRetryable' })).toContain('was not retryable')
  expect(harnessExecutionFailureReason({ name: 'AI_RetryError', reason: 'abort' })).toContain('was aborted')
})

test('suppresses native validation content, nested schema messages and tool inputs', () => {
  const error = new TypeValidationError({ value: { prompt: 'private customer material' }, cause: new Error('private schema value') })
  expect(error.message).toContain('private customer material')
  expect(harnessExecutionFailureReason(error)).toBe('The AI SDK received data that does not match the expected schema. (AI_TypeValidationError)')
  const toolError = new InvalidToolInputError({ toolName: 'private tool', toolInput: 'private input', cause: error })
  const reason = harnessExecutionFailureReason(toolError)
  expect(reason).toContain('tool inputs that do not match')
  expect(reason).toContain('Caused by: The AI SDK received data')
  expect(reason).not.toContain('private')
  expect(harnessExecutionFailureReason({ name: 'AI_ToolCallRepairError', originalError: toolError })).toContain(reason)
})

test.each(['AI_StreamProviderError', 'AI_UIMessageStreamError', 'AI_InvalidStreamPartError'])('marks partial output incomplete for %s', name => {
  expect(harnessExecutionFailureReason({ name, message: 'private' })).toContain('Any partial response is incomplete.')
})

test('preserves content-filter diagnosis in native streams and nested SDK retries', () => {
  const streamError = new StreamProviderError({ message: 'private', code: 'data_inspection_failed', isRetryable: true, data: { prompt: 'private' } })
  const expected = 'The model provider blocked this response with its content filter (data_inspection_failed). Any partial response is incomplete.'
  expect(harnessExecutionFailureReason(streamError)).toBe(expected)
  expect(harnessExecutionFailureReason({ name: 'AI_RetryError', lastError: streamError })).toBe(expected)
  expect(harnessExecutionFailureReason({ name: 'AI_APICallError', data: { error: { code: 'data_inspection_failed' } } })).toBe(expected)
  expect(harnessExecutionFailureReason(new StreamProviderError({ message: 'private', statusCode: 503 })))
    .toBe('The model provider encountered a server error. Any partial response is incomplete. (AI_StreamProviderError, HTTP 503)')
})

test('unknown SDK errors and malformed metadata have safe bounded fallbacks', () => {
  const reason = harnessExecutionFailureReason({ name: 'AI_FutureProviderError', message: 'private', cause: new Error('private') })
  expect(reason).toBe('The AI SDK could not complete this operation. Share this error type with support. (AI_FutureProviderError)')
  for (const statusCode of ['429 private', '429', 999, 200, NaN, {}, 429.1]) {
    expect(harnessExecutionFailureReason({ name: 'AI_APICallError', statusCode, message: 'private' }))
      .toBe('The request to the model provider failed. (AI_APICallError)')
  }
  const circular = { name: 'AI_RetryError', lastError: undefined as unknown,
    get message() { throw new Error('private'); }, get statusCode() { throw new Error('private'); } }
  circular.lastError = circular
  expect(harnessExecutionFailureReason(circular)).toBe('The model request could not complete within the AI SDK retry policy. (AI_RetryError)')
  const beyondLimit = { get name() { throw new Error('must not be visited'); } }
  let deep: unknown = beyondLimit
  for (let index = 0; index < 4; index++) deep = { name: 'AI_RetryError', lastError: deep }
  expect(harnessExecutionFailureReason(deep)).toBe(harnessExecutionFailureReason(circular))
})

test('preserves SDK descriptions for transport without carrying payloads or changing unrelated errors', () => {
  const original = new APICallError({ message: 'private', url: 'https://private.test', requestBodyValues: { prompt: 'private' }, statusCode: 429 })
  const transported = preserveHarnessSDKFailure(original) as Error
  expect(transported.name).toBe('HarnessModelFailure')
  expect(transported.cause).toBeUndefined()
  expect(JSON.stringify(transported)).not.toContain('private')
  const serialized = { name: transported.name, message: transported.message }
  expect(harnessExecutionFailureReason({ name: 'FatalError', message: 'Step failed', cause: serialized }))
    .toBe(harnessExecutionFailureReason(original))
  expect(harnessExecutionFailureReason(preserveHarnessSDKFailure(transported))).toBe(harnessExecutionFailureReason(original))
  const unrelated = new Error('Connection closed')
  expect(preserveHarnessSDKFailure(unrelated)).toBe(unrelated)
})
