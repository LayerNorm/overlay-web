// Security Service - Centralized security utilities for Overlay
// Handles redacted audit logging and code signing verification.

import { app } from 'electron'
import { createHash } from 'crypto'
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync
} from 'fs'
import { dirname, join, resolve } from 'path'
import { redactTelemetryValue } from '../../../shared/security/telemetry-redaction'

// ── Audit Logging ─────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'auth:login'
  | 'auth:logout'
  | 'auth:token_refresh'
  | 'auth:token_access'
  | 'api:key_fetch'
  | 'api:request'
  | 'platform/usage:track'
  | 'platform/usage:limit_exceeded'
  | 'security:tampering_detected'

interface AuditLogEntry {
  timestamp: string
  type: AuditEventType
  userId?: string
  action: string
  details?: Record<string, unknown>
  ip?: string
  success: boolean
}

class AuditLogger {
  private readonly logDir: string
  private buffer: AuditLogEntry[] = []
  private flushInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.logDir = join(app.getPath('userData'), 'logs', 'audit')
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true, mode: 0o700 })
    }
    chmodSync(this.logDir, 0o700)
    this.removeExpiredLogs()

    // Flush buffer every 5 seconds
    this.flushInterval = setInterval(() => this.flush(), 5000)
  }

  log(entry: Omit<AuditLogEntry, 'timestamp'>): void {
    const fullEntry: AuditLogEntry = {
      ...entry,
      userId: entry.userId ? this.pseudonymize(entry.userId) : undefined,
      details: redactTelemetryValue(entry.details) as Record<string, unknown> | undefined,
      ip: undefined,
      timestamp: new Date().toISOString()
    }
    this.buffer.push(fullEntry)
    if (!(entry.type === 'auth:token_access' && entry.success)) {
      console.log(
        `[Audit] ${entry.type}: ${entry.action} - ${entry.success ? 'success' : 'failed'}`
      )
    }

    // Immediate flush for security events
    if (entry.type.startsWith('security:')) {
      this.flush()
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return

    try {
      const lines = this.buffer.map((e) => JSON.stringify(e)).join('\n') + '\n'
      const logPath = join(this.logDir, `audit-${new Date().toISOString().split('T')[0]}.log`)
      appendFileSync(logPath, lines, { encoding: 'utf-8', mode: 0o600 })
      chmodSync(logPath, 0o600)
      this.buffer = []
    } catch (error) {
      console.error('[Audit] Failed to write audit log:', error)
    }
  }

  private pseudonymize(userId: string): string {
    return createHash('sha256').update(`overlay-desktop-audit:${userId}`).digest('hex').slice(0, 24)
  }

  private removeExpiredLogs(): void {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
    for (const name of readdirSync(this.logDir)) {
      if (!/^audit-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue
      const path = join(this.logDir, name)
      try {
        if (statSync(path).mtimeMs < cutoff) unlinkSync(path)
      } catch {
        // Retention cleanup is best effort; logging remains available.
      }
    }
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
    }
    this.flush()
  }
}

// ── Code Signing Verification ─────────────────────────────────────────────────

let codeSigningError: string | null = null

export async function verifyCodeSigning(): Promise<{ valid: boolean; error?: string }> {
  if (!app.isPackaged) {
    // Skip verification in development
    return { valid: true }
  }

  try {
    if (process.platform === 'darwin') {
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execFileAsync = promisify(execFile)
      const executablePath = app.getPath('exe')
      let bundlePath = dirname(executablePath)
      while (!bundlePath.endsWith('.app') && dirname(bundlePath) !== bundlePath) {
        bundlePath = dirname(bundlePath)
      }
      if (!bundlePath.endsWith('.app')) {
        throw new Error('Unable to resolve the application bundle')
      }

      try {
        await execFileAsync('/usr/bin/codesign', [
          '--verify',
          '--deep',
          '--strict',
          '--verbose=2',
          resolve(bundlePath)
        ])
        auditLogger.log({
          type: 'security:tampering_detected',
          action: 'Code signing verification passed',
          success: true
        })
        return { valid: true }
      } catch (err) {
        codeSigningError = 'Code signature verification failed'
        auditLogger.log({
          type: 'security:tampering_detected',
          action: 'Code signing verification FAILED',
          details: { error: String(err) },
          success: false
        })
        return { valid: false, error: codeSigningError }
      }
    }

    // Windows/Linux: Skip for now (would need different verification)
    return { valid: true }
  } catch (error) {
    codeSigningError = String(error)
    return { valid: false, error: codeSigningError }
  }
}

// ── Export Singleton Instances ────────────────────────────────────────────────

export const auditLogger = new AuditLogger()

// Cleanup on app quit
app.on('before-quit', () => {
  auditLogger.destroy()
})
