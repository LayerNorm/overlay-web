import type { AnyMessage, Stream } from '@agentclientprotocol/sdk'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

/** ACP dispatches notifications independently of responses. Finish each update before forwarding the next wire item. */
export function orderedAcpUpdates(stream: Stream) {
  let pending: ReturnType<typeof deferred> | undefined
  const readable = stream.readable.pipeThrough(new TransformStream<AnyMessage, AnyMessage>({
    async transform(message, controller) {
      if (message && typeof message === 'object' && 'method' in message && message.method === 'session/update' && !('id' in message)) {
        const completion = deferred()
        pending = completion
        controller.enqueue(message)
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([completion.promise, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('ACP session update processing timed out')), 15000)
          })])
        } finally { if (timer) clearTimeout(timer); pending = undefined }
      } else controller.enqueue(message)
    },
  }))
  return {
    stream: { readable, writable: stream.writable },
    complete() { pending?.resolve() },
    fail(error: unknown) { pending?.reject(error) },
  }
}
