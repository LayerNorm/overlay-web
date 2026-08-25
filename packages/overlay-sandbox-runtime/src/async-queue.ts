export class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private readers: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T) {
    if (this.closed) return
    const reader = this.readers.shift()
    if (reader) reader({ done: false, value })
    else this.values.push(value)
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const reader of this.readers.splice(0)) reader({ done: true, value: undefined })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.values.shift()
        if (value !== undefined) return { done: false, value }
        if (this.closed) return { done: true, value: undefined }
        return await new Promise<IteratorResult<T>>((resolve) => this.readers.push(resolve))
      },
    }
  }
}
