type ChatStreamChunk = { type?: string; id?: string; delta?: string; toolName?: string; errorText?: string }

/**
 * Translates the personal chat's UI message stream into the Notebook editor's
 * NDJSON events: whole text segments, tool rows, errors and one final `done`.
 */
export function chatStreamToNotebookEvents(onEnd: () => void): TransformStream<string, Uint8Array> {
  const encoder = new TextEncoder()
  const texts = new Map<string, string>()
  let buffer = ''
  let done = false
  const emit = (controller: TransformStreamDefaultController<Uint8Array>, event: Record<string, unknown>) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
  }
  const flushText = (controller: TransformStreamDefaultController<Uint8Array>, id?: string) => {
    for (const [key, text] of texts) {
      if (id !== undefined && key !== id) continue
      if (text.trim()) emit(controller, { type: 'text', text })
      texts.delete(key)
    }
  }
  const handle = (controller: TransformStreamDefaultController<Uint8Array>, line: string) => {
    const data = line.startsWith('data:') ? line.slice(5).trim() : ''
    if (!data || data === '[DONE]') return
    let chunk: ChatStreamChunk
    try {
      chunk = JSON.parse(data) as ChatStreamChunk
    } catch {
      return
    }
    const id = chunk.id ?? ''
    if (chunk.type === 'text-delta') texts.set(id, (texts.get(id) ?? '') + (chunk.delta ?? ''))
    else if (chunk.type === 'text-end') flushText(controller, id)
    else if (chunk.type === 'tool-input-available' && chunk.toolName) {
      flushText(controller)
      emit(controller, { type: 'tool_call', tool: chunk.toolName })
    } else if (chunk.type === 'error') {
      flushText(controller)
      emit(controller, { type: 'error', error: chunk.errorText || 'The response could not be completed.' })
    } else if (chunk.type === 'finish' && !done) {
      flushText(controller)
      done = true
      emit(controller, { type: 'done' })
    }
  }
  return new TransformStream<string, Uint8Array>({
    transform(text, controller) {
      buffer += text
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) handle(controller, line.trim())
    },
    flush(controller) {
      if (buffer.trim()) handle(controller, buffer.trim())
      flushText(controller)
      if (!done) emit(controller, { type: 'done' })
      onEnd()
    },
  })
}
