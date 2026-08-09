import 'server-only'

import { redactSecrets } from '@/shared/security/sentry-sanitize'
import { getObservabilityContext } from './context'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogContext = Record<string, unknown>

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const SENSITIVE_KEY_PARTS = [
  'access',
  'api',
  'authorization',
  'body',
  'cookie',
  'content',
  'document',
  'email',
  'error',
  'input',
  'instruction',
  'ip',
  'jwt',
  'key',
  'name',
  'output',
  'password',
  'prompt',
  'query',
  'reason',
  'secret',
  'session',
  'sub',
  'token',
  'useragent',
  'userid',
  'user_id',
]

const SENSITIVE_KEY_EXACT = new Set(['text'])

function configuredLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[configuredLogLevel()]
}

function isRecord(value: unknown): value is LogContext {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll('-', '_')
  return SENSITIVE_KEY_EXACT.has(normalized) || SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
}

function redactLogString(value: string): string {
  return redactSecrets(value)
    .replace(/\buserId=([^\s|,]+)/g, 'userId=[REDACTED]')
    .replace(/\buser\s+([A-Za-z0-9_-]{8,})\b/gi, 'user [REDACTED]')
}

function sanitizeForLog(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === 'string') return redactLogString(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) {
    const code = 'code' in value && typeof value.code === 'string'
      ? value.code.slice(0, 128)
      : undefined
    return {
      ...(code ? { code: redactLogString(code) } : {}),
      name: redactLogString(value.name),
    }
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item, seen))
  if (!isRecord(value)) return String(value)
  if (seen.has(value)) return '[Circular]'
  const output: LogContext = {}
  seen.set(value, output)
  for (const [key, entry] of Object.entries(value)) {
    output[key] = shouldRedactKey(key) ? '[REDACTED]' : sanitizeForLog(entry, seen)
  }
  return output
}

function serializePayload(payload: LogContext): string {
  return JSON.stringify(sanitizeForLog(payload))
}

function sanitizeLogArgument(value: unknown): unknown {
  // Positional strings have no field name to classify, so they could be user
  // content. Error instances still retain a safe type and optional code.
  if (typeof value === 'string' || Array.isArray(value)) return '[REDACTED]'
  return sanitizeForLog(value)
}

function write(level: LogLevel, message: string, ...args: unknown[]): void {
  if (!shouldLog(level)) return
  const payload: LogContext = {
    level,
    message: redactLogString(message),
    observability: getObservabilityContext(),
    timestamp: new Date().toISOString(),
  }
  if (args.length === 1 && isRecord(args[0])) {
    payload.context = sanitizeForLog(args[0])
  } else if (args.length > 0) {
    payload.context = args.map(sanitizeLogArgument)
  }

  if (level === 'error') {
    console.error(serializePayload(payload))
  } else if (level === 'warn') {
    console.warn(serializePayload(payload))
  } else if (level === 'debug') {
    console.debug(serializePayload(payload))
  } else {
    console.info(serializePayload(payload))
  }
}

export const logger = {
  debug: (message: string, ...args: unknown[]) => write('debug', message, ...args),
  info: (message: string, ...args: unknown[]) => write('info', message, ...args),
  warn: (message: string, ...args: unknown[]) => write('warn', message, ...args),
  error: (message: string, ...args: unknown[]) => write('error', message, ...args),
}

export type { LogContext, LogLevel }
