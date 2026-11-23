/**
 * Language-server feedback for computer edits. The driver keeps typescript-language-server / pyright warm per repo;
 * these helpers decide which files to check and reduce raw diagnostics to what the edit changed, so the model sees
 * "you introduced 2 errors" instead of every pre-existing warning in the file.
 */

export type ComputerDiagnostic = {
  line: number
  column: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  code?: string | number
  source?: string
}

export type ComputerFileDiagnostics = {
  path: string
  diagnostics: ComputerDiagnostic[]
  total: number
  pending?: boolean
}

export type ComputerDiagnosticsSummary = {
  /** Errors and warnings in touched files that were not there before the edit. */
  introduced: Array<ComputerDiagnostic & { path: string }>
  /** Errors and warnings that the edit removed. */
  resolvedCount: number
  /** Errors still present after the edit, new or not. */
  errorCount: number
  warningCount: number
  /** False when there was no usable baseline, so every current problem is listed as introduced. */
  compared: boolean
  /** Files the language server had not finished checking in time. */
  pending?: string[]
  truncated?: boolean
}

export type ComputerLspLanguage = 'typescript' | 'python'

const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const PYTHON_EXTENSIONS = ['.py', '.pyi']
const MAX_INTRODUCED = 30
/** At most this many files per language are checked after one edit or patch. */
export const COMPUTER_DIAGNOSTICS_MAX_FILES = 20

export function computerLspLanguage(path: string): ComputerLspLanguage | null {
  const lower = path.toLowerCase()
  if (lower.endsWith('.d.ts')) return null
  if (TYPESCRIPT_EXTENSIONS.some(extension => lower.endsWith(extension))) return 'typescript'
  if (PYTHON_EXTENSIONS.some(extension => lower.endsWith(extension))) return 'python'
  return null
}

/** Groups checkable paths by language, so each language server gets one request covering all its files. */
export function computerDiagnosticsBatches(paths: string[]): Array<{ language: ComputerLspLanguage; paths: string[] }> {
  const groups = new Map<ComputerLspLanguage, string[]>()
  for (const path of new Set(paths)) {
    const language = computerLspLanguage(path)
    if (!language) continue
    const group = groups.get(language) ?? []
    if (group.length < COMPUTER_DIAGNOSTICS_MAX_FILES) group.push(path)
    groups.set(language, group)
  }
  return [...groups].map(([language, group]) => ({ language, paths: group }))
}

function isProblem(diagnostic: ComputerDiagnostic) {
  return diagnostic.severity === 'error' || diagnostic.severity === 'warning'
}

/** Line numbers shift with every edit, so diagnostics match on what they say, not where they are. */
function identity(path: string, diagnostic: ComputerDiagnostic) {
  return `${path}\u0000${diagnostic.severity}\u0000${diagnostic.code ?? ''}\u0000${diagnostic.message}`
}

function counts(files: ComputerFileDiagnostics[]) {
  const map = new Map<string, number>()
  for (const file of files) {
    for (const diagnostic of file.diagnostics) {
      if (!isProblem(diagnostic)) continue
      const key = identity(file.path, diagnostic)
      map.set(key, (map.get(key) ?? 0) + 1)
    }
  }
  return map
}

export function summarizeComputerDiagnostics(
  before: ComputerFileDiagnostics[] | null,
  after: ComputerFileDiagnostics[],
): ComputerDiagnosticsSummary {
  const baseline = before ? counts(before) : new Map<string, number>()
  const remaining = new Map(baseline)
  const introduced: ComputerDiagnosticsSummary['introduced'] = []
  let errorCount = 0
  let warningCount = 0
  for (const file of after) {
    for (const diagnostic of file.diagnostics) {
      if (!isProblem(diagnostic)) continue
      if (diagnostic.severity === 'error') errorCount += 1
      else warningCount += 1
      const key = identity(file.path, diagnostic)
      const left = remaining.get(key) ?? 0
      if (left > 0) {
        remaining.set(key, left - 1)
        continue
      }
      introduced.push({ path: file.path, ...diagnostic })
    }
  }
  const resolvedCount = [...remaining.values()].reduce((sum, value) => sum + value, 0)
  introduced.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  const pending = after.filter(file => file.pending).map(file => file.path)
  return {
    introduced: introduced.slice(0, MAX_INTRODUCED),
    resolvedCount: before ? resolvedCount : 0,
    errorCount,
    warningCount,
    compared: before !== null,
    ...(pending.length ? { pending } : {}),
    ...(introduced.length > MAX_INTRODUCED ? { truncated: true } : {}),
  }
}

/** Reads the driver's lsp_request diagnostics payload defensively; anything malformed is dropped. */
export function parseComputerDiagnostics(value: unknown): ComputerFileDiagnostics[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { files?: unknown }).files)) return []
  const files: ComputerFileDiagnostics[] = []
  for (const raw of (value as { files: unknown[] }).files) {
    if (!raw || typeof raw !== 'object') continue
    const file = raw as Record<string, unknown>
    if (typeof file.path !== 'string' || !Array.isArray(file.diagnostics)) continue
    const diagnostics = file.diagnostics.flatMap((entry): ComputerDiagnostic[] => {
      if (!entry || typeof entry !== 'object') return []
      const item = entry as Record<string, unknown>
      if (typeof item.line !== 'number' || typeof item.column !== 'number' || typeof item.message !== 'string') return []
      const severity = item.severity === 'warning' || item.severity === 'info' || item.severity === 'hint' ? item.severity : 'error'
      return [{
        line: item.line,
        column: item.column,
        severity,
        message: item.message,
        ...(typeof item.code === 'string' || typeof item.code === 'number' ? { code: item.code } : {}),
        ...(typeof item.source === 'string' ? { source: item.source } : {}),
      }]
    })
    files.push({
      path: file.path,
      diagnostics,
      total: typeof file.total === 'number' ? file.total : diagnostics.length,
      ...(file.pending === true ? { pending: true } : {}),
    })
  }
  return files
}
