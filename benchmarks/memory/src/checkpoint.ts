import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config } from './config'

/**
 * Append-only JSONL checkpoints per (runId, stage). A run can be interrupted
 * and resumed — completed ids are skipped.
 */
export class Checkpoint<T extends { id: string }> {
  private readonly file: string
  private readonly done = new Set<string>()

  constructor(runId: string, stage: string) {
    const dir = path.join(config.resultsDir, runId)
    mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, `${stage}.jsonl`)
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          this.done.add((JSON.parse(line) as { id: string }).id)
        } catch {
          // tolerate a torn final line from an interrupted write
        }
      }
    }
  }

  has(id: string): boolean {
    return this.done.has(id)
  }

  record(row: T): void {
    appendFileSync(this.file, JSON.stringify(row) + '\n')
    this.done.add(row.id)
  }

  /** Drop an id and rewrite the log — for "checkpointed but actually gone" resumes. */
  remove(id: string): void {
    if (!this.done.delete(id)) return
    const rows = this.all().filter((r) => r.id !== id)
    writeFileSync(this.file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))
  }

  all(): T[] {
    if (!existsSync(this.file)) return []
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T)
  }
}
