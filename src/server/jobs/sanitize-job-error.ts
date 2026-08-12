import 'server-only'

/**
 * Sanitizes an error for safe storage in the database.
 * Stores only the error message and class name, not the full stack trace,
 * to avoid leaking internal file paths, env var names, or code structure.
 */
export function sanitizeJobError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || 'Error'
    const message = error.message || String(error)
    // Truncate excessively long messages to prevent storage abuse
    const truncated = message.length > 2_000 ? message.slice(0, 2_000) + '…[truncated]' : message
    return `${name}: ${truncated}`
  }
  const str = String(error)
  return str.length > 2_000 ? str.slice(0, 2_000) + '…[truncated]' : str
}
