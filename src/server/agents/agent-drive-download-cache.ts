import 'server-only'

/** Short-lived verified bytes only. Authorization and current Files revision are never cached. */
export class AgentDriveDownloadCache {
  private readonly entries = new Map<string, {bytes: number; expiresAt: number; pending: boolean; value: Promise<Uint8Array>}>()
  constructor(private readonly maximumBytes = 32 * 1024 * 1024, private readonly now = Date.now) {}

  async read(key: string, size: number, load: () => Promise<Uint8Array>): Promise<Uint8Array> {
    for (const [id, entry] of this.entries) if (!entry.pending && entry.expiresAt <= this.now()) this.entries.delete(id)
    const existing = this.entries.get(key)
    if (existing) return Uint8Array.from(await existing.value)
    let used = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    for (const [id, entry] of this.entries) {
      if (used + size <= this.maximumBytes && this.entries.size < 64) break
      if (!entry.pending) { this.entries.delete(id); used -= entry.bytes }
    }
    if (!Number.isSafeInteger(size) || size < 0 || used + size > this.maximumBytes || this.entries.size >= 64) throw Error('DRIVE_DOWNLOAD_BUSY')
    const entry = {bytes: size, expiresAt: Infinity, pending: true, value: Promise.resolve().then(load).then(bytes => Uint8Array.from(bytes))}
    this.entries.set(key, entry)
    try {
      const bytes = await entry.value
      if (bytes.byteLength !== size) throw Error('DRIVE_SOURCE_CHANGED')
      entry.pending = false
      entry.expiresAt = this.now() + 30_000
      return Uint8Array.from(bytes)
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key)
      throw error
    }
  }
}
