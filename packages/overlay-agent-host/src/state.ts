import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { agentHostEventSchema, type AgentHostEvent } from '@layernorm/overlay-agent-bridge-protocol'

export type StoredRemoteSession = { config?: { version: 1; model?: string; configReference?: string; toolsReference?: string }; execution?: { attemptId: string; generation: number; hostBootId?: string };  runId: string; adapterId: string; remoteSessionId: string; workingDirectory: string }
export type StoredCommandResult = { accepted: boolean; errorCode?: string; errorMessage?: string; sequence: number }
export type StoredAdapterSessionState = { runId: string; adapterId: string; state: Record<string, unknown> }
export type HostStateScope = { environmentId: string; workspaceId: string }

export class SqliteHostStateStore {
  private readonly database: DatabaseSync

  constructor(path: string, scope?: HostStateScope) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.database = new DatabaseSync(path)
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS command_claims (command_id TEXT PRIMARY KEY);
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
      CREATE TABLE IF NOT EXISTS host_scope (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS remote_sessions (
        run_id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL,
        remote_session_id TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_claims (run_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_session_config (run_id TEXT PRIMARY KEY, config_json TEXT NOT NULL);
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
      CREATE TABLE IF NOT EXISTS attempted_uploads (run_id TEXT PRIMARY KEY, through_sequence INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS run_sequences (
        run_id TEXT PRIMARY KEY,
        last_sequence INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS event_outbox_run_sequence ON event_outbox(run_id, source_sequence);
    `)
    // Queued rows from an older host may already have reached the server. Treat them as immutable on upgrade too.
    this.database.exec(`INSERT INTO attempted_uploads(run_id, through_sequence)
      SELECT run_id, MAX(source_sequence) FROM event_outbox GROUP BY run_id
      ON CONFLICT(run_id) DO UPDATE SET through_sequence = MAX(through_sequence, excluded.through_sequence)`)
    if (scope) this.assertScope(scope)
  }

  close(): void { this.database.close() }

  private assertScope(scope: HostStateScope): void {
    const environmentId = this.scopeValue('environment_id')
    const workspaceId = this.scopeValue('workspace_id')
    if (environmentId && workspaceId && (environmentId !== scope.environmentId || workspaceId !== scope.workspaceId)) {
      this.database.close()
      throw new Error('host state scope does not match the host configuration')
    }
    this.database.prepare('INSERT OR IGNORE INTO host_scope(key, value) VALUES (?, ?)').run('environment_id', scope.environmentId)
    this.database.prepare('INSERT OR IGNORE INTO host_scope(key, value) VALUES (?, ?)').run('workspace_id', scope.workspaceId)
  }

  private scopeValue(key: string): string | undefined {
    const row = this.database.prepare('SELECT value FROM host_scope WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

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

  claimCommand(commandId: string): boolean {
    return this.database.prepare('INSERT OR IGNORE INTO command_claims(command_id) VALUES (?)').run(commandId).changes === 1
  }

  commandCursor(): number {
    const row = this.database.prepare("SELECT value FROM host_state WHERE key = 'command_cursor'").get() as { value: number } | undefined
    return Number(row?.value ?? 0)
  }

  adoptCommandCursor(lastConsumedSequence: number): boolean {
    if (lastConsumedSequence < 1) return false
    if (this.commandCursor() !== 0) return false
    this.database.prepare(`INSERT INTO host_state(key, value) VALUES ('command_cursor', ?)
      ON CONFLICT(key) DO UPDATE SET value=MAX(value, excluded.value)`).run(lastConsumedSequence)
    return true
  }

  // Forward-only cursor move used when the server attests that skipped numbers are resolved:
  // unlike adoptCommandCursor this also runs once a cursor exists, and it can never move back.
  resumeCommandCursor(resolvedThroughSequence: number): boolean {
    if (resolvedThroughSequence < 1) return false
    this.database.prepare(`INSERT INTO host_state(key, value) VALUES ('command_cursor', ?)
      ON CONFLICT(key) DO UPDATE SET value=MAX(value, excluded.value)`).run(resolvedThroughSequence)
    return true
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
      this.database.prepare('DELETE FROM command_claims WHERE command_id = ?').run(commandId)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  claimExecution(runId: string, attemptId: string): boolean {
    // Commit before the process can perform an external action. An unknown outcome is never re-prompted.
    return this.database.prepare('INSERT OR IGNORE INTO execution_claims(run_id, attempt_id) VALUES (?, ?)').run(runId, attemptId).changes === 1
  }

  saveSession(session: StoredRemoteSession, now = Date.now()): void {
    this.database.prepare(`
      INSERT INTO remote_sessions(run_id, adapter_id, remote_session_id, working_directory, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET adapter_id=excluded.adapter_id, remote_session_id=excluded.remote_session_id,
        working_directory=excluded.working_directory, updated_at=excluded.updated_at
    `).run(session.runId, session.adapterId, session.remoteSessionId, session.workingDirectory, now)
    if (session.config || session.execution) this.database.prepare('INSERT INTO remote_session_config(run_id, config_json) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET config_json=excluded.config_json').run(session.runId, JSON.stringify({ config: session.config, execution: session.execution }))
  }

  getSession(runId: string): StoredRemoteSession | undefined {
    const row = this.database.prepare('SELECT run_id, adapter_id, remote_session_id, working_directory FROM remote_sessions WHERE run_id = ?').get(runId) as Record<string, unknown> | undefined
    if (!row) return undefined
    const saved = this.database.prepare('SELECT config_json FROM remote_session_config WHERE run_id = ?').get(runId) as { config_json: string } | undefined
    const configuration = saved ? JSON.parse(saved.config_json) as Pick<StoredRemoteSession, 'config' | 'execution'> : {}
    return { ...configuration, runId: String(row.run_id), adapterId: String(row.adapter_id), remoteSessionId: String(row.remote_session_id), workingDirectory: String(row.working_directory) }
  }

  deleteSession(runId: string): void {
    this.database.prepare('DELETE FROM remote_sessions WHERE run_id = ?').run(runId)
    this.database.prepare('DELETE FROM remote_session_config WHERE run_id = ?').run(runId)
    this.database.prepare('DELETE FROM execution_claims WHERE run_id = ?').run(runId)
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
      const streamId = eventStreamId(event.runId, event.execution?.attemptId)
      const row = this.database.prepare('SELECT last_sequence FROM run_sequences WHERE run_id = ?').get(streamId) as { last_sequence: number } | undefined
      const stored = agentHostEventSchema.parse({ ...event, sourceSequence: Number(row?.last_sequence ?? 0) + 1 })
      this.database.prepare('INSERT INTO event_outbox(event_id, environment_id, run_id, source_sequence, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(stored.eventId, stored.environmentId, streamId, stored.sourceSequence, JSON.stringify(stored), Date.now())
      this.database.prepare(`INSERT INTO run_sequences(run_id, last_sequence) VALUES (?, ?)
        ON CONFLICT(run_id) DO UPDATE SET last_sequence=excluded.last_sequence`).run(streamId, stored.sourceSequence)
      this.database.exec('COMMIT')
      return stored
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Appends a text checkpoint, or replaces the queued one when it is the newest event of its stream and is not
   * being uploaded (`inFlightThrough` is the highest sequence currently in flight). Only the latest checkpoint
   * matters to the transcript, so while uploads are slow the backlog stays one row instead of growing with every
   * flush. Sequence numbers stay contiguous because the replaced row keeps its own.
   */
  appendOrReplaceTextCheckpoint(event: Omit<AgentHostEvent, 'sourceSequence'>, inFlightThrough: number): AgentHostEvent {
    if (event.type !== 'text_checkpoint') return this.appendEvent(event)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const streamId = eventStreamId(event.runId, event.execution?.attemptId)
      const tail = this.database.prepare('SELECT source_sequence, body FROM event_outbox WHERE run_id = ? ORDER BY source_sequence DESC LIMIT 1')
        .get(streamId) as { source_sequence: number; body: string } | undefined
      const tailEvent = tail ? JSON.parse(tail.body) as AgentHostEvent : undefined
      if (tail && tailEvent?.type === 'text_checkpoint' && Number(tail.source_sequence) > Math.max(inFlightThrough, this.attemptedThrough(streamId))
        && JSON.stringify(tailEvent.execution ?? null) === JSON.stringify(event.execution ?? null)) {
        const stored = agentHostEventSchema.parse({ ...event, sourceSequence: Number(tail.source_sequence) })
        this.database.prepare('UPDATE event_outbox SET event_id = ?, body = ? WHERE run_id = ? AND source_sequence = ?')
          .run(stored.eventId, JSON.stringify(stored), streamId, stored.sourceSequence)
        this.database.exec('COMMIT')
        return stored
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.appendEvent(event)
  }

  /** Rewrites one queued event in place (same stream and sequence), e.g. to shrink a checkpoint that cannot be sent. */
  replaceQueuedEvent(event: AgentHostEvent): void {
    const stored = agentHostEventSchema.parse(event)
    this.database.prepare('UPDATE event_outbox SET body = ? WHERE run_id = ? AND source_sequence = ?')
      .run(JSON.stringify(stored), eventStreamId(stored.runId, stored.execution?.attemptId), stored.sourceSequence)
  }

  /** An upload may have reached the server even when its response was lost. Never rewrite those sequences. */
  markUploadAttempt(events: AgentHostEvent[]): void {
    const last = events.at(-1)
    if (!last) return
    this.database.prepare(`INSERT INTO attempted_uploads(run_id, through_sequence) VALUES (?, ?)
      ON CONFLICT(run_id) DO UPDATE SET through_sequence = MAX(through_sequence, excluded.through_sequence)`)
      .run(eventStreamId(last.runId, last.execution?.attemptId), last.sourceSequence)
  }

  private attemptedThrough(streamId: string): number {
    const row = this.database.prepare('SELECT through_sequence FROM attempted_uploads WHERE run_id = ?').get(streamId)
    return Number(row?.through_sequence ?? 0)
  }

  pendingEvents(limit: number): AgentHostEvent[] {
    const first = this.database.prepare('SELECT run_id FROM event_outbox ORDER BY created_at, source_sequence LIMIT 1').get() as { run_id: string } | undefined
    if (!first) return []
    const rows = this.database.prepare('SELECT body FROM event_outbox WHERE run_id = ? ORDER BY source_sequence LIMIT ?').all(first.run_id, limit) as Array<{ body: string }>
    return rows.map((row) => agentHostEventSchema.parse(JSON.parse(row.body)))
  }

  acknowledgeEvents(runId: string, throughSequence: number, attemptId?: string): void {
    this.database.prepare('DELETE FROM event_outbox WHERE run_id = ? AND source_sequence <= ?').run(eventStreamId(runId, attemptId), throughSequence)
  }

  discardEventsBefore(runId: string, expectedSequence: number, attemptId?: string): void {
    this.database.prepare('DELETE FROM event_outbox WHERE run_id = ? AND source_sequence < ?').run(eventStreamId(runId, attemptId), expectedSequence)
  }

  outboxSize(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM event_outbox').get() as { count: number }
    return Number(row.count)
  }
}

function eventStreamId(runId: string, attemptId?: string) { return attemptId ? JSON.stringify([runId, attemptId]) : runId }
