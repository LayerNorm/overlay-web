import { harnessExecutionFailureReason, preserveHarnessSDKFailure } from '../../src/server/harness/execution-failure'

async function failSDKStep(kind: 'retry' | 'stream' | 'validation'): Promise<void> {
  'use step'
  const { APICallError, RetryError, StreamProviderError, TypeValidationError } = await import('ai')
  if (kind === 'retry') {
    throw preserveHarnessSDKFailure(new RetryError({ message: 'private retry details', reason: 'maxRetriesExceeded', errors: [
      new APICallError({ message: 'private provider response', url: 'https://private.test',
        requestBodyValues: { prompt: 'private customer prompt' }, statusCode: 429 }),
    ] }))
  }
  if (kind === 'stream') {
    throw preserveHarnessSDKFailure(new StreamProviderError({ message: 'private stream response', statusCode: 503, isRetryable: true }))
  }
  throw preserveHarnessSDKFailure(new TypeValidationError({ value: { error: { code: 'data_inspection_failed' }, content: 'private content' },
    cause: new Error('private schema value') }))
}
failSDKStep.maxRetries = 0

export async function failureDescriptionFixture(kind: 'retry' | 'stream' | 'validation'): Promise<string> {
  'use workflow'
  try {
    await failSDKStep(kind)
    return 'Unexpected success'
  } catch (error) {
    return harnessExecutionFailureReason(error)
  }
}
