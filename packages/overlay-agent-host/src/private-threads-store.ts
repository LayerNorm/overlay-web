import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { PrivateThread, PrivateThreadOwner, PrivateUIMessage } from './private-threads-protocol.js'

/**
 * Private threads are stored only on this computer, in one SQLite file in the
 * app's support folder. Messages are AI SDK UI messages, saved after every step.
 */
export class PrivateThreadStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        folder TEXT,
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS threads_owner ON threads (user_id, workspace_id, updated_at);
      CREATE TABLE IF NOT EXISTS messages (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        id TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (thread_id, position)
      );
    `)
  }

  list(owner: PrivateThreadOwner): PrivateThread[] {
    return (this.db.prepare(
      'SELECT * FROM threads WHERE user_id = ? AND workspace_id = ? ORDER BY updated_at DESC LIMIT 500',
    ).all(owner.userId, owner.workspaceId) as ThreadRow[]).map(toThread)
  }

  get(owner: PrivateThreadOwner, id: string): PrivateThread | null {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ? AND user_id = ? AND workspace_id = ?')
      .get(id, owner.userId, owner.workspaceId) as ThreadRow | undefined
    return row ? toThread(row) : null
  }

  create(thread: PrivateThread): PrivateThread {
    this.db.prepare(`INSERT INTO threads (id, user_id, workspace_id, agent_id, title, folder, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      thread.id, thread.userId, thread.workspaceId, thread.agentId, thread.title,
      thread.folder, thread.model, thread.createdAt, thread.updatedAt,
    )
    return thread
  }

  update(owner: PrivateThreadOwner, id: string, patch: Partial<Pick<PrivateThread, 'title' | 'model' | 'folder'>>): PrivateThread | null {
    const current = this.get(owner, id)
    if (!current) return null
    const next = { ...current, ...patch, updatedAt: Date.now() }
    this.db.prepare('UPDATE threads SET title = ?, model = ?, folder = ?, updated_at = ? WHERE id = ?')
      .run(next.title, next.model, next.folder, next.updatedAt, id)
    return next
  }

  delete(owner: PrivateThreadOwner, id: string): boolean {
    return Number(this.db.prepare('DELETE FROM threads WHERE id = ? AND user_id = ? AND workspace_id = ?')
      .run(id, owner.userId, owner.workspaceId).changes) > 0
  }

  messages(id: string): PrivateUIMessage[] {
    return (this.db.prepare('SELECT body FROM messages WHERE thread_id = ? ORDER BY position').all(id) as { body: string }[])
      .map(row => JSON.parse(row.body) as PrivateUIMessage)
  }

  /** Replaces the whole transcript in one transaction, so a crash leaves the last complete step. */
  saveMessages(id: string, messages: PrivateUIMessage[]): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM messages WHERE thread_id = ?').run(id)
      const insert = this.db.prepare('INSERT INTO messages (thread_id, position, id, body) VALUES (?, ?, ?, ?)')
      messages.forEach((message, position) => insert.run(id, position, message.id, JSON.stringify(message)))
      this.db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(Date.now(), id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.db.close()
  }
}

type ThreadRow = {
  id: string
  user_id: string
  workspace_id: string
  agent_id: string
  title: string
  folder: string | null
  model: string | null
  created_at: number
  updated_at: number
}

function toThread(row: ThreadRow): PrivateThread {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    title: row.title,
    folder: row.folder,
    model: row.model,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}
