import { isRecord } from '../agents/thread-pull-request-json'

const RESPONSE_KEYS = new Set([
  'number', 'html_url', 'url', 'title', 'state', 'draft', 'merged', 'merged_at',
  'updated_at', 'updatedAt', 'closed', 'isDraft', 'reopened', 'ready_for_review',
  'successful', 'success', 'error', 'isError', 'denied', 'tool_slug', 'toolName',
  'tool_name', 'index', 'data', 'results', 'response', 'response_data', 'responseData',
  'result', 'output', 'pull_request', 'pullRequest', 'structuredContent', 'content',
  'type', 'text', 'arguments',
])
const INPUT_KEYS = new Set([
  'tools', 'tool_slug', 'toolName', 'tool_name', 'arguments', 'owner', 'repo', 'pull_number',
])

function jsonObject(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : value
  } catch {
    return value
  }
}

function narrow(value: unknown, keys: Set<string>, depth = 0): unknown {
  if (depth > 10) return null
  if (typeof value === 'string') {
    const parsed = jsonObject(value)
    return parsed === value ? value : JSON.stringify(narrow(parsed, keys, depth + 1))
  }
  if (Array.isArray(value)) return value.length > 32 ? value : value.map(item => narrow(item, keys, depth + 1))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => keys.has(key))
    .map(([key, item]) => [key, narrow(item, key === 'arguments' ? INPUT_KEYS : keys, depth + 1)]))
}

function hasPullRequestUrl(value: unknown, depth = 0): boolean {
  if (depth > 10) return false
  if (typeof value === 'string') {
    const parsed = jsonObject(value)
    if (parsed !== value) return hasPullRequestUrl(parsed, depth + 1)
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && url.hostname === 'github.com'
        && !url.username && !url.password && !url.port && !url.search && !url.hash
        && /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(url.pathname)
    } catch {
      return false
    }
  }
  if (Array.isArray(value)) return value.some(item => hasPullRequestUrl(item, depth + 1))
  return isRecord(value) && Object.values(value).some(item => hasPullRequestUrl(item, depth + 1))
}

export function compactPullRequestToolValues(invocation: Record<string, unknown>) {
  const name = typeof invocation.toolName === 'string' ? invocation.toolName.toUpperCase() : ''
  if (!/^(?:GITHUB_[A-Z_]+|(?:WORKSPACE_)?COMPOSIO_MULTI_EXECUTE_TOOL|CALL_MCP_TOOL)$/.test(name)) return null
  const serialized = JSON.stringify(invocation.toolOutput)
  const input = JSON.stringify(invocation.toolInput)
  if (!serialized || !input || serialized.length > 64_000 || input.length > 64_000) return null
  if (serialized.length <= 4_000 && input.length <= 4_000) return null
  const toolOutput = narrow(invocation.toolOutput, RESPONSE_KEYS)
  const output = JSON.stringify(toolOutput)
  if (output.length > 4_000 || !hasPullRequestUrl(toolOutput)) return null
  return { toolInput: narrow(invocation.toolInput, INPUT_KEYS), toolOutput }
}
