import { asSchema } from 'ai'
import type { WorkspaceAgentToolingResult } from '@/server/agents/agent-tooling'
import type { HarnessToolFailureIssue } from '@overlay/agent-runtime/harness-store'

type NativeInputIssue = HarnessToolFailureIssue

const SAFE_VALIDATION_CODES = new Set([
  'custom', 'invalid_element', 'invalid_format', 'invalid_key', 'invalid_type', 'invalid_union', 'invalid_value',
  'not_multiple_of', 'too_big', 'too_small', 'unrecognized_keys',
])

function safeValidationPath(path: unknown, schema: unknown): string[] {
  if (!Array.isArray(path)) return []
  const safePath: string[] = []
  let currentSchema = schema
  for (const part of path.slice(0, 6)) {
    const node = unwrapInputSchema(currentSchema)
    const arrayElement = node && typeof node === 'object'
      ? (node as { element?: unknown; _def?: { type?: unknown } }).element
        ?? (node as { _def?: { type?: unknown } })._def?.type
      : undefined
    if (typeof part === 'number' && Number.isSafeInteger(part) && part >= 0 && arrayElement && typeof arrayElement === 'object') {
      safePath.push(`#${part}`)
      currentSchema = arrayElement
      continue
    }
    const shape = node && typeof node === 'object'
      ? (node as { shape?: unknown; _def?: { shape?: unknown } }).shape
        ?? (node as { _def?: { shape?: unknown } })._def?.shape
      : undefined
    const properties = typeof shape === 'function' ? shape() : shape
    if (typeof part !== 'string' || !properties || typeof properties !== 'object' || !Object.hasOwn(properties, part)) {
      safePath.push('<field>')
      break
    }
    const sensitive = /(token|password|secret|authorization|credential|api.?key)/i.test(part)
    safePath.push(!sensitive && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(part) ? part : '<field>')
    currentSchema = (properties as Record<string, unknown>)[part]
  }
  return safePath
}

function unwrapInputSchema(schema: unknown): unknown {
  let current = schema
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const definition = (current as { _def?: { schema?: unknown; innerType?: unknown }; _zod?: { def?: { schema?: unknown; innerType?: unknown } } })._def
      ?? (current as { _zod?: { def?: { schema?: unknown; innerType?: unknown } } })._zod?.def
    const inner = definition?.schema ?? definition?.innerType
    if (!inner || inner === current || typeof inner !== 'object') break
    current = inner
  }
  return current
}

function safeValidationIssues(error: unknown, schema: unknown): NativeInputIssue[] {
  const value = error && typeof error === 'object' ? error as { issues?: unknown; cause?: unknown } : undefined
  const cause = value?.cause && typeof value.cause === 'object'
    ? value.cause as { issues?: unknown } : undefined
  const issues = Array.isArray(value?.issues) ? value.issues : Array.isArray(cause?.issues) ? cause.issues : []
  return issues.slice(0, 8).map(issue => {
    const fields = issue && typeof issue === 'object' ? issue as { path?: unknown; code?: unknown } : {}
    const path = safeValidationPath(fields.path, schema)
    const code = typeof fields.code === 'string' && SAFE_VALIDATION_CODES.has(fields.code)
      ? fields.code as NativeInputIssue['code'] : 'invalid_input'
    return { path, code }
  })
}

export function nativeToolInputFailure(toolName: string, error: unknown, schema: unknown) {
  const issues = safeValidationIssues(error, schema)
  const guidance = toolName === 'computer_browser' || toolName === 'computer_open_url'
    ? 'Browser URLs must use HTTP or HTTPS. Serve local HTML over a verified HTTP(S) origin; file:// URLs are unsupported.'
    : 'Tool input does not match the expected fields. Correct the reported fields and try again.'
  const fields = issues.map(issue => `${issue.path.join('.') || 'input'} (${issue.code})`).join(', ')
  return {
    success: false as const,
    code: 'INVALID_TOOL_INPUT',
    error: fields ? `${guidance} Invalid fields: ${fields}.` : guidance,
    issues,
  }
}

export async function validateNativeToolInput(
  toolName: string,
  definition: WorkspaceAgentToolingResult['tools'][string],
  input: unknown,
) {
  const schema = asSchema(definition.inputSchema)
  if (!schema.validate) throw new Error('NATIVE_TOOL_SCHEMA_VALIDATOR_MISSING')
  const result = await schema.validate(input)
  if (result.success) return { success: true as const, value: result.value }
  return { success: false as const, value: nativeToolInputFailure(toolName, result.error, definition.inputSchema) }
}
