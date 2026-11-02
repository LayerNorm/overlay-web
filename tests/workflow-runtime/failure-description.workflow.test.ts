import { expect, test } from 'vitest'
import { start } from 'workflow/api'
import { failureDescriptionFixture } from './failure-description-fixture'

test.each([
  ['retry', 'The model request still failed after the AI SDK exhausted its retries. (AI_RetryError)'
    + ' Caused by: The model provider rate limit or quota was exceeded. Check provider limits before trying again. (AI_APICallError, HTTP 429)'],
  ['stream', 'The model provider encountered a server error. Any partial response is incomplete. (AI_StreamProviderError, HTTP 503)'],
  ['validation', 'The model provider blocked this response with its content filter (data_inspection_failed). Any partial response is incomplete.'],
] as const)('describes %s errors across the real compiled step/workflow boundary', async (kind, expected) => {
  const run = await start(failureDescriptionFixture, [kind])
  expect(await run.returnValue).toBe(expected)
})
