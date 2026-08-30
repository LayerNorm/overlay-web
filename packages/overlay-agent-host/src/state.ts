import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { agentHostEventSchema, type AgentHostEvent } from '@layernorm/agent-bridge-protocol'

export type StoredRemoteSession = { runId: string; adapterId: string; remoteSessionId: string; workingDirectory: string }
export type StoredCommandResult = { accepted: boolean; errorCode?: string; errorMessage?: string; sequence: number }
export type StoredAdapterSessionState = { runId: string; adapterId: string; state: Record<string, unknown> }

export class SqliteHostStateStore {
  private readonly database: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.database = new DatabaseSync(path)
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS processed_commands (
        command_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        accepted INTEGER NOT NULL,
        error_code TEXT,
        error_message TEXT,
        processed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS host_state (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS remote_sessions (
        run_id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL,
        remote_session_id TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS adapter_session_state (
        run_id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_outbox (
        event_id TEXT PRIMARY KEY,
        environment_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        source_sequence INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(run_id, source_sequence)
      );
      CREATE TABLE IF NOT EXISTS run_sequences (
        run_id TEXT PRIMARY KEY,
        last_sequence INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS event_outbox_run_sequence ON event_outbox(run_id, source_sequence);
    `)
  }

  close(): void { this.database.close() }

  hasProcessedCommand(commandId: string): boolean {
    return this.getProcessedCommand(commandId) !== undefined
  }

  getProcessedCommand(commandId: string): StoredCommandResult | undefined {
    const row = this.database.prepare('SELECT sequence, accepted, error_code, error_message FROM processed_commands WHERE command_id = ?').get(commandId) as Record<string, unknown> | undefined
    if (!row) return undefined
    return {
      sequence: Number(row.sequence), accepted: Number(row.accepted) === 1,
      ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
      ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
    }
  }

  commandCursor(): number {
    const row = this.database.prepare("SELECT value FROM host_state WHERE key = 'command_cursor'").get() as { value: number } | undefined
    return Number(row?.value ?? 0)
  }

  recordCommandResult(commandId: string, result: StoredCommandResult, now = Date.now()): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`INSERT OR IGNORE INTO processed_commands(
        command_id, sequence, accepted, error_code, error_message, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?)`).run(
        commandId, result.sequence, result.accepted ? 1 : 0,
        result.errorCode ?? null, result.errorMessage ?? null, now,
      )
      this.database.prepare(`INSERT INTO host_state(key, value) VALUES ('command_cursor', ?)
        ON CONFLICT(key) DO UPDATE SET value=MAX(value, excluded.value)`).run(result.sequence)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  saveSession(session: StoredRemoteSession, now = Date.now()): void {
    this.database.prepare(`
      INSERT INTO remote_sessions(run_id, adapter_id, remote_session_id, working_directory, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET adapter_id=excluded.adapter_id, remote_session_id=excluded.remote_session_id,
        working_directory=excluded.working_directory, updated_at=excluded.updated_at
    `).run(session.runId, session.adapterId, session.remoteSessionId, session.workingDirectory, now)
  }

  getSession(runId: string): StoredRemoteSession | undefined {
    const row = this.database.prepare('SELECT run_id, adapter_id, remote_session_id, working_directory FROM remote_sessions WHERE run_id = ?').get(runId) as Record<string, unknown> | undefined
    if (!row) return undefined
    return { runId: String(row.run_id), adapterId: String(row.adapter_id), remoteSessionId: String(row.remote_session_id), workingDirectory: String(row.working_directory) }
  }

  deleteSession(runId: string): void {
    this.database.prepare('DELETE FROM remote_sessions WHERE run_id = ?').run(runId)
  }

  saveAdapterSessionState(runId: string, adapterId: string, state: Record<string, unknown>, now = Date.now()): void {
    this.database.prepare(`
      INSERT INTO adapter_session_state(run_id, adapter_id, state_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET adapter_id=excluded.adapter_id,
        state_json=excluded.state_json, updated_at=excluded.updated_at
    `).run(runId, adapterId, JSON.stringify(state), now)
  }

  getAdapterSessionState(runId: string, adapterId: string): Record<string, unknown> | undefined {
    const row = this.database.prepare('SELECT adapter_id, state_json FROM adapter_session_state WHERE run_id = ?').get(runId) as { adapter_id: string; state_json: string } | undefined
    if (!row) return undefined
    if (row.adapter_id !== adapterId) throw new Error('adapter session state belongs to a different adapter')
    const parsed: unknown = JSON.parse(row.state_json)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('adapter session state is invalid')
    return parsed as Record<string, unknown>
  }

  deleteAdapterSessionState(runId: string): void {
    this.database.prepare('DELETE FROM adapter_session_state WHERE run_id = ?').run(runId)
  }

  appendEvent(event: Omit<AgentHostEvent, 'sourceSequence'>): AgentHostEvent {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const row = this.database.prepare('SELECT last_sequence FROM run_sequences WHERE run_id = ?').get(event.runId) as { last_sequence: number } | undefined
      const stored = agentHostEventSchema.parse({ ...event, sourceSequence: Number(row?.last_sequence ?? 0) + 1 })
      this.database.prepare('INSERT INTO event_outbox(event_id, environment_id, run_id, source_sequence, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(stored.eventId, stored.environmentId, stored.runId, stored.sourceSequence, JSON.stringify(stored), Date.now())
      this.database.prepare(`INSERT INTO run_sequences(run_id, last_sequence) VALUES (?, ?)
        ON CONFLICT(run_id) DO UPDATE SET last_sequence=excluded.last_sequence`).run(stored.runId, stored.sourceSequence)
      this.database.exec('COMMIT')
      return stored
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  pendingEvents(limit: number): AgentHostEvent[] {
    const first = this.database.prepare('SELECT run_id FROM event_outbox ORDER BY created_at, source_sequence LIMIT 1').get() as { run_id: string } | undefined
    if (!first) return []
    const rows = this.database.prepare('SELECT body FROM event_outbox WHERE run_id = ? ORDER BY source_sequence LIMIT ?').all(first.run_id, limit) as Array<{ body: string }>
    return rows.map((row) => agentHostEventSchema.parse(JSON.parse(row.body)))
  }

  acknowledgeEvents(runId: string, throughSequence: number): void {
    this.database.prepare('DELETE FROM event_outbox WHERE run_id = ? AND source_sequence <= ?').run(runId, throughSequence)
  }

  discardEventsBefore(runId: string, expectedSequence: number): void {
    this.database.prepare('DELETE FROM event_outbox WHERE run_id = ? AND source_sequence < ?').run(runId, expectedSequence)
  }

  outboxSize(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM event_outbox').get() as { count: number }
    return Number(row.count)
  }
}
