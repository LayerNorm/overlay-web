// Canonical Ask SSE fixture modeled on what the Overlay backend streams for
// a simple single-variant text reply that also invokes a tool. Used by
// tests/ask-stream.test.ts to exercise `parseSseBlock` and
// `applyAskChunkToMessage` end-to-end without a network.
export const ASK_SSE_FIXTURE = [
  `data: ${JSON.stringify({ type: 'start', messageMetadata: { modelId: 'gpt-5' } })}`,
  '',
  `data: ${JSON.stringify({ type: 'text-start', id: 'p1' })}`,
  '',
  `data: ${JSON.stringify({ type: 'text-delta', id: 'p1', delta: 'Hello' })}`,
  '',
  `data: ${JSON.stringify({ type: 'text-delta', id: 'p1', delta: ', world' })}`,
  '',
  `data: ${JSON.stringify({
    type: 'tool-input-start',
    toolCallId: 't1',
    toolName: 'readCurrentPage',
  })}`,
  '',
  `data: ${JSON.stringify({
    type: 'tool-input-delta',
    toolCallId: 't1',
    inputTextDelta: '{"sel',
  })}`,
  '',
  `data: ${JSON.stringify({
    type: 'tool-input-delta',
    toolCallId: 't1',
    inputTextDelta: 'ector":"body"}',
  })}`,
  '',
  `data: ${JSON.stringify({
    type: 'tool-input-available',
    toolCallId: 't1',
    toolName: 'readCurrentPage',
    input: { selector: 'body' },
  })}`,
  '',
  `data: ${JSON.stringify({
    type: 'tool-output-available',
    toolCallId: 't1',
    output: { text: 'ok' },
  })}`,
  '',
  `data: ${JSON.stringify({ type: 'text-delta', id: 'p1', delta: '!' })}`,
  '',
  `data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}`,
  '',
  'data: [DONE]',
  '',
].join('\n')
