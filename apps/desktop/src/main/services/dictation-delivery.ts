/** Keep delivery policy testable without injecting global keys or reading user text. */
export async function deliverDictation<T>(
  text: string,
  target: number | null,
  io: {
    currentTarget(): Promise<number | null>
    snapshot(): T | null
    write(text: string): void
    read(): string
    restore(value: T): void
    paste(): Promise<void>
    active(): boolean
  }
): Promise<'inserted' | 'copy'> {
  if (!text.trim() || !io.active() || target === null) return 'copy'
  if ((await io.currentTarget()) !== target || !io.active()) return 'copy'
  const original = io.snapshot()
  if (original === null) return 'copy'
  io.write(text)
  try {
    // Recheck after the asynchronous target lookup, before injecting a key.
    if (!io.active()) return 'copy'
    await io.paste()
    return 'inserted'
  } catch {
    return 'copy'
  } finally {
    // Preserve a copy the user made while insertion was in flight.
    if (io.read() === text) io.restore(original)
  }
}
