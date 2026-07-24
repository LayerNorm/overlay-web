// Security Service - Centralized security utilities for Overlay
// Handles redacted audit logging, rate limiting, and code signing verification.

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
  | 'ipc:sensitive_call'
  | 'ipc:rate_limited'
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

// ── Rate Limiting ─────────────────────────────────────────────────────────────

interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map()
  private configs: Map<string, RateLimitConfig> = new Map()

  constructor() {
    // Default rate limits for sensitive operations
    this.setConfig('auth:refresh', { maxRequests: 5, windowMs: 60000 }) // 5 per minute
    this.setConfig('api:key_fetch', { maxRequests: 10, windowMs: 60000 }) // 10 per minute
    this.setConfig('platform/usage:track', { maxRequests: 100, windowMs: 60000 }) // 100 per minute
    this.setConfig('ipc:sensitive', { maxRequests: 30, windowMs: 60000 }) // 30 per minute
    this.setConfig('ai:request', { maxRequests: 60, windowMs: 60000 }) // 60 per minute
  }

  setConfig(operation: string, config: RateLimitConfig): void {
    this.configs.set(operation, config)
  }

  check(
    operation: string,
    identifier: string = 'default'
  ): { allowed: boolean; remaining: number; resetIn: number } {
    const key = `${operation}:${identifier}`
    const config = this.configs.get(operation) || { maxRequests: 100, windowMs: 60000 }
    const now = Date.now()

    let entry = this.limits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + config.windowMs }
      this.limits.set(key, entry)
    }

    entry.count++
    const allowed = entry.count <= config.maxRequests
    const remaining = Math.max(0, config.maxRequests - entry.count)
    const resetIn = entry.resetAt - now

    return { allowed, remaining, resetIn }
  }

  reset(operation: string, identifier: string = 'default'): void {
    const key = `${operation}:${identifier}`
    this.limits.delete(key)
  }
}

// ── Code Signing Verification ─────────────────────────────────────────────────

let codeSigningVerified = false
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
        codeSigningVerified = true
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

export function isCodeSigningVerified(): boolean {
  return codeSigningVerified || !app.isPackaged
}

// ── Export Singleton Instances ────────────────────────────────────────────────

export const auditLogger = new AuditLogger()
export const rateLimiter = new RateLimiter()

// ── IPC Security Wrapper ──────────────────────────────────────────────────────

export function secureIpcHandler<T>(
  operation: string,
  handler: (...args: unknown[]) => Promise<T>,
  options: {
    rateLimit?: boolean
    audit?: boolean
    userId?: () => string | undefined
  } = {}
): (...args: unknown[]) => Promise<T> {
  return async (...args: unknown[]): Promise<T> => {
    const userId = options.userId?.()

    // Rate limiting
    if (options.rateLimit !== false) {
      const { allowed, remaining, resetIn } = rateLimiter.check(
        'ipc:sensitive',
        userId || 'anonymous'
      )
      if (!allowed) {
        auditLogger.log({
          type: 'ipc:rate_limited',
          action: `Rate limited: ${operation}`,
          userId,
          details: { remaining, resetIn },
          success: false
        })
        throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(resetIn / 1000)} seconds.`)
      }
    }

    // Audit logging
    if (options.audit !== false) {
      auditLogger.log({
        type: 'ipc:sensitive_call',
        action: operation,
        userId,
        details: { argsCount: args.length },
        success: true
      })
    }

    return handler(...args)
  }
}

// Cleanup on app quit
app.on('before-quit', () => {
  auditLogger.destroy()
})
