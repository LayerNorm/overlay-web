const SECRET_KEY = /(authorization|credential|secret|token|private.?key|password)/i

export type LogSink = (line: string) => void

export class StructuredLogger {
  constructor(private readonly sink: LogSink = (line) => process.stderr.write(`${line}\n`)) {}

  info(message: string, fields: Record<string, unknown> = {}): void { this.write('info', message, fields) }
  warn(message: string, fields: Record<string, unknown> = {}): void { this.write('warn', message, fields) }
  error(message: string, fields: Record<string, unknown> = {}): void { this.write('error', message, fields) }

  private write(level: string, message: string, fields: Record<string, unknown>): void {
    this.sink(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...(redact(fields) as Record<string, unknown>) }))
  }
}

export function redact(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [nestedKey, redact(nestedValue, nestedKey)]))
  }
  return value
}
