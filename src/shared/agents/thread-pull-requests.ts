import type { WorkspaceThreadPullRequest } from '@overlay/workspace-contracts'

const MAX_PARTS = 256
const MAX_BATCH_TOOLS = 32
const MAX_PULL_REQUESTS = 20
const MAX_FINGERPRINT_LENGTH = 64_000
const MAX_TEXT_LENGTH = 16_384
const MAX_OBJECT_KEYS = 128
const MAX_ARRAY_ITEMS = 64
const MAX_JSON_DEPTH = 10
const MAX_JSON_NODES = 2_000
const MAX_RESPONSE_DEPTH = 6

type PullRequestOperation = 'create' | 'update' | 'merge' | 'close' | 'reopen' | 'draft' | 'ready' | 'read'

type PullRequestObservation = {
  owner: string
  repo: string
  number: number
  title?: string
  url: string
  state: WorkspaceThreadPullRequest['state']
  updatedAt?: number
}

type ToolRequest = {
  toolName: string
  operation: PullRequestOperation
  toolInput: Record<string, unknown>
}

type ToolRequestWithOutput = ToolRequest & { toolOutput: unknown }

type CompletedToolCall = {
  toolCallId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolOutput: unknown
  fingerprint: string
}

const GITHUB_PULL_REQUEST_TOOLS: Record<string, PullRequestOperation> = {
  GITHUB_CREATE_A_PULL_REQUEST: 'create',
  GITHUB_UPDATE_A_PULL_REQUEST: 'update',
  GITHUB_MERGE_A_PULL_REQUEST: 'merge',
  GITHUB_CLOSE_A_PULL_REQUEST: 'close',
  GITHUB_REOPEN_A_PULL_REQUEST: 'reopen',
  GITHUB_CONVERT_PULL_REQUEST_TO_DRAFT: 'draft',
  GITHUB_CONVERT_A_PULL_REQUEST_TO_DRAFT: 'draft',
  GITHUB_MARK_PULL_REQUEST_READY_FOR_REVIEW: 'ready',
  GITHUB_MARK_A_PULL_REQUEST_READY_FOR_REVIEW: 'ready',
  GITHUB_GET_A_PULL_REQUEST: 'read',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeStableStringify(value: unknown): string | null {
  let nodes = 0
  const seen = new WeakSet<object>()

  const visit = (current: unknown, depth: number): unknown => {
    nodes += 1
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new Error('JSON limit exceeded')
    if (typeof current === 'string') {
      if (current.length > MAX_TEXT_LENGTH) throw new Error('String limit exceeded')
      return current
    }
    if (current === null || typeof current === 'boolean' || typeof current === 'number') {
      return current
    }
    if (Array.isArray(current)) {
      if (current.length > MAX_ARRAY_ITEMS || seen.has(current)) throw new Error('Array limit exceeded')
      seen.add(current)
      const result = current.map(item => visit(item, depth + 1))
      seen.delete(current)
      return result
    }
    if (!isRecord(current) || seen.has(current)) throw new Error('Object limit exceeded')
    const keys = Object.keys(current).sort()
    if (keys.length > MAX_OBJECT_KEYS) throw new Error('Object key limit exceeded')
    seen.add(current)
    const result: Record<string, unknown> = {}
    for (const key of keys) {
      if (key.length > 256) throw new Error('Key limit exceeded')
      result[key] = visit(current[key], depth + 1)
    }
    seen.delete(current)
    return result
  }

  try {
    const serialized = JSON.stringify(visit(value, 0))
    return typeof serialized === 'string' && serialized.length <= MAX_FINGERPRINT_LENGTH ? serialized : null
  } catch {
    return null
  }
}

function completedToolCalls(parts: unknown): Map<string, CompletedToolCall> {
  const out = new Map<string, CompletedToolCall>()
  const duplicates = new Set<string>()
  if (!Array.isArray(parts) || parts.length > MAX_PARTS) return out

  for (const part of parts) {
    if (!isRecord(part) || part.type !== 'tool-invocation' || !isRecord(part.toolInvocation)) continue
    const invocation = part.toolInvocation
    const toolCallId = invocation.toolCallId
    const toolName = invocation.toolName
    const toolInput = invocation.toolInput
    const toolOutput = invocation.toolOutput
    if (invocation.state !== 'output-available'
      || typeof toolCallId !== 'string' || !toolCallId || toolCallId.length > 256
      || typeof toolName !== 'string' || !toolName || toolName.length > 128
      || !isRecord(toolInput) || toolOutput === undefined) continue
    if (duplicates.has(toolCallId)) continue

    const fingerprint = safeStableStringify({ toolName, toolInput, toolOutput })
    if (!fingerprint) continue
    if (out.has(toolCallId)) {
      out.delete(toolCallId)
      duplicates.add(toolCallId)
      continue
    }
    out.set(toolCallId, { toolCallId, toolName, toolInput, toolOutput, fingerprint })
  }
  return out
}

function pullRequestOperation(toolName: string): PullRequestOperation | null {
  const normalized = toolName.toUpperCase()
  if (normalized === 'CALL_MCP_TOOL') return null
  if (normalized === 'COMPOSIO_MULTI_EXECUTE_TOOL'
    || normalized === 'WORKSPACE_COMPOSIO_MULTI_EXECUTE_TOOL') return null
  return GITHUB_PULL_REQUEST_TOOLS[normalized] ?? null
}

function githubToolSlug(value: unknown): { toolName: string; operation: PullRequestOperation } | null {
  if (typeof value !== 'string' || value.length > 128 || !/^[a-z0-9_]+$/i.test(value)) return null
  const toolName = value.toUpperCase()
  const operation = GITHUB_PULL_REQUEST_TOOLS[toolName]
  return operation ? { toolName, operation } : null
}

function inputRepository(input: Record<string, unknown>): { owner: string; repo: string; number?: number } | null {
  const owner = input.owner
  const repo = input.repo
  if (!validSlug(owner, 39) || !validSlug(repo, 100)) return null
  const number = input.pull_number === undefined ? undefined : positivePullRequestNumber(input.pull_number)
  if (number === null) return null
  return { owner, repo, ...(number === undefined ? {} : { number }) }
}

function validSlug(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && /^[A-Za-z0-9_.-]+$/.test(value)
    && value !== '.'
    && value !== '..'
}

function positivePullRequestNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
    ? value
    : null
}

function canonicalGitHubPullRequestUrl(value: unknown): { owner: string; repo: string; number: number; url: string } | null {
  if (typeof value !== 'string' || value.length > 512) return null
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,39})\/([A-Za-z0-9_.-]{1,100})\/pull\/([1-9]\d{0,9})$/.exec(value)
  if (!match) return null
  const [, owner, repo, rawNumber] = match
  if (!validSlug(owner, 39) || !validSlug(repo, 100) || owner === '.' || repo === '.') return null
  const number = positivePullRequestNumber(Number(rawNumber))
  if (number === null) return null
  return { owner, repo, number, url: value }
}

function isFailure(value: Record<string, unknown>): boolean {
  return value.isError === true
    || value.denied === true
    || value.success === false
    || value.successful === false
    || (value.error !== undefined && value.error !== null && value.error !== '')
}

function looksLikePullRequest(value: Record<string, unknown>): boolean {
  return ['number', 'html_url', 'url', 'state', 'draft', 'merged', 'merged_at']
    .some(key => Object.prototype.hasOwnProperty.call(value, key))
}

const RESPONSE_WRAPPERS = [
  'pull_request',
  'pullRequest',
  'response_data',
  'responseData',
  'data',
  'response',
  'result',
] as const

function pullRequestObjects(value: unknown, depth = 0): Record<string, unknown>[] {
  if (!isRecord(value) || isFailure(value) || depth > MAX_RESPONSE_DEPTH) return []
  if (looksLikePullRequest(value)) return [value]
  const out: Record<string, unknown>[] = []
  for (const key of RESPONSE_WRAPPERS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      out.push(...pullRequestObjects(value[key], depth + 1))
      if (out.length >= MAX_BATCH_TOOLS) break
    }
  }
  return out
}

function jsonTextPayload(text: unknown): unknown | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_LENGTH) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function mcpPayloads(output: unknown, allowPartialFailures = false): unknown[] {
  if (!isRecord(output) || output.isError === true || (!allowPartialFailures && isFailure(output))) return []
  const out: unknown[] = []
  if (Object.prototype.hasOwnProperty.call(output, 'structuredContent')) {
    out.push(output.structuredContent)
  }
  if (Array.isArray(output.content) && output.content.length <= MAX_ARRAY_ITEMS) {
    for (const block of output.content) {
      if (!isRecord(block) || block.type !== 'text') continue
      const payload = jsonTextPayload(block.text)
      if (payload) out.push(payload)
    }
  }
  if (Object.prototype.hasOwnProperty.call(output, 'results')) out.push(output)
  if (out.length === 0 && !Object.prototype.hasOwnProperty.call(output, 'content')
    && !Object.prototype.hasOwnProperty.call(output, 'structuredContent')) {
    out.push(output)
  }
  return out.slice(0, MAX_BATCH_TOOLS)
}

function mcpRequest(call: CompletedToolCall): ToolRequest | null {
  if (call.toolName !== 'call_mcp_tool') return null
  const requested = githubToolSlug(call.toolInput.toolName)
  const args = call.toolInput.arguments
  if (!requested || !isRecord(args)) return null
  return { toolName: requested.toolName, operation: requested.operation, toolInput: args }
}

type BatchToolInput = {
  toolName: string
  operation: PullRequestOperation
  toolInput: Record<string, unknown>
} | null

function batchToolInputs(input: Record<string, unknown>): BatchToolInput[] {
  if (!Array.isArray(input.tools) || input.tools.length > MAX_BATCH_TOOLS) return []
  const out: BatchToolInput[] = []
  for (const tool of input.tools) {
    if (!isRecord(tool)) {
      out.push(null)
      continue
    }
    const requested = githubToolSlug(tool.tool_slug ?? tool.toolName ?? tool.tool_name)
    const toolInput = tool.arguments
    out.push(requested && isRecord(toolInput) ? { ...requested, toolInput } : null)
  }
  return out
}

function batchResults(output: unknown): unknown[] {
  const out: unknown[] = []
  const visit = (value: unknown, depth: number) => {
    if (!isRecord(value) || depth > MAX_RESPONSE_DEPTH || value.isError === true) return
    if (Array.isArray(value.results)) {
      out.push(...value.results.slice(0, MAX_BATCH_TOOLS))
      return
    }
    for (const key of ['structuredContent', 'response_data', 'responseData', 'data', 'result'] as const) {
      if (Object.prototype.hasOwnProperty.call(value, key)) visit(value[key], depth + 1)
      if (out.length >= MAX_BATCH_TOOLS) return
    }
  }
  for (const payload of mcpPayloads(output, true)) {
    visit(payload, 0)
    if (out.length >= MAX_BATCH_TOOLS) break
  }
  return out.slice(0, MAX_BATCH_TOOLS)
}

function matchedBatchRequests(call: CompletedToolCall): ToolRequestWithOutput[] {
  const wrapperName = call.toolName.toUpperCase()
  if (wrapperName !== 'COMPOSIO_MULTI_EXECUTE_TOOL'
    && wrapperName !== 'WORKSPACE_COMPOSIO_MULTI_EXECUTE_TOOL') return []
  const requests = batchToolInputs(call.toolInput)
  const results = batchResults(call.toolOutput)
  const out: ToolRequestWithOutput[] = []
  const matchedInputIndexes = new Set<number>()
  for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
    const result = results[resultIndex]
    if (!isRecord(result) || isFailure(result)) continue
    const resultName = result.tool_slug ?? result.toolName ?? result.tool_name
    const matched = githubToolSlug(resultName)
    if (!matched) continue
    const availableIndexes = requests.flatMap((request, index) => (
      request?.toolName === matched.toolName && !matchedInputIndexes.has(index) ? [index] : []
    ))
    const resultArguments = isRecord(result.arguments) ? safeStableStringify(result.arguments) : null
    let inputIndex: number | undefined
    const positionalRequest = requests[resultIndex]
    if (positionalRequest?.toolName === matched.toolName && !matchedInputIndexes.has(resultIndex)) {
      const positionalArgumentsMatch = resultArguments !== null
        && safeStableStringify(positionalRequest.toolInput) === resultArguments
      const positionalIsUnambiguous = availableIndexes.length === 1
        || requests.length === results.length
      if ((resultArguments === null && positionalIsUnambiguous) || positionalArgumentsMatch) {
        inputIndex = resultIndex
      }
    }
    if (inputIndex === undefined && resultArguments !== null) {
      const argumentMatches = availableIndexes.filter(index => (
        safeStableStringify(requests[index]?.toolInput) === resultArguments
      ))
      if (argumentMatches.length === 1) inputIndex = argumentMatches[0]
    } else if (inputIndex === undefined && availableIndexes.length === 1) {
      inputIndex = availableIndexes[0]
    }
    if (inputIndex === undefined) continue
    const request = requests[inputIndex]
    if (!request) continue
    const resultPayload = result.response_data ?? result.responseData ?? result.result ?? result.output ?? result.response ?? result
    if (!isRecord(resultPayload)) continue
    matchedInputIndexes.add(inputIndex)
    out.push({ ...request, toolOutput: resultPayload })
  }
  return out
}

function requestForCall(call: CompletedToolCall): ToolRequestWithOutput[] {
  const wrapperName = call.toolName.toUpperCase()
  if (wrapperName === 'CALL_MCP_TOOL') {
    const request = mcpRequest(call)
    return request ? [{ ...request, toolOutput: call.toolOutput }] : []
  }
  if (wrapperName === 'COMPOSIO_MULTI_EXECUTE_TOOL'
    || wrapperName === 'WORKSPACE_COMPOSIO_MULTI_EXECUTE_TOOL') {
    return matchedBatchRequests(call)
  }
  const operation = pullRequestOperation(call.toolName)
  return operation
    ? [{ toolName: call.toolName.toUpperCase(), operation, toolInput: call.toolInput, toolOutput: call.toolOutput }]
    : []
}

function updatedAtFrom(value: Record<string, unknown>): number | undefined {
  const raw = value.updated_at ?? value.updatedAt
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : undefined
  if (typeof raw === 'string' && raw.length <= 64) {
    const parsed = Date.parse(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
  return undefined
}

function stateFrom(value: Record<string, unknown>): WorkspaceThreadPullRequest['state'] | null {
  const state = typeof value.state === 'string' ? value.state.toLowerCase() : ''
  if (value.merged === true
    || (value.merged_at !== undefined && value.merged_at !== null && value.merged_at !== '')
    || state === 'merged') return 'merged'
  if (state === 'closed' || value.closed === true) return 'closed'
  if (state === 'draft' || value.draft === true || value.isDraft === true) return 'draft'
  if (state === 'open' || value.reopened === true || value.ready_for_review === true) return 'open'
  return null
}

function operationConfirmsState(
  operation: PullRequestOperation,
  state: WorkspaceThreadPullRequest['state'],
): boolean {
  if (state === 'merged') return true
  switch (operation) {
    case 'merge': return false
    case 'close': return state === 'closed'
    case 'reopen': return state === 'open' || state === 'draft'
    case 'draft': return state === 'draft'
    case 'ready': return state === 'open'
    default: return true
  }
}

function observationFrom(
  response: Record<string, unknown>,
  request: ToolRequest,
): PullRequestObservation | null {
  const state = stateFrom(response)
  if (!state || !operationConfirmsState(request.operation, state)) return null

  const inputRepo = inputRepository(request.toolInput)
  const hasResponseUrl = Object.prototype.hasOwnProperty.call(response, 'html_url')
    || Object.prototype.hasOwnProperty.call(response, 'url')
  let identity: { owner: string; repo: string; number: number; url: string } | null
  const responseNumber = response.number === undefined ? null : positivePullRequestNumber(response.number)
  if (response.number !== undefined && responseNumber === null) return null
  if (hasResponseUrl) {
    const rawUrl = response.html_url ?? response.url
    identity = canonicalGitHubPullRequestUrl(rawUrl)
    if (!identity || responseNumber === null || identity.number !== responseNumber) return null
    if (inputRepo && (identity.owner.toLowerCase() !== inputRepo.owner.toLowerCase()
      || identity.repo.toLowerCase() !== inputRepo.repo.toLowerCase()
      || inputRepo.number !== undefined && identity.number !== inputRepo.number)) return null
  } else {
    if (!inputRepo || inputRepo.number === undefined) return null
    if (responseNumber !== null && responseNumber !== inputRepo.number) return null
    identity = canonicalGitHubPullRequestUrl(
      `https://github.com/${inputRepo.owner}/${inputRepo.repo}/pull/${inputRepo.number}`,
    )
    if (!identity) return null
  }

  const title = typeof response.title === 'string' && response.title.trim().length > 0
    && response.title.length <= 512
    ? response.title.trim()
    : undefined

  const updatedAt = updatedAtFrom(response)
  return {
    ...identity,
    ...(title ? { title } : {}),
    state,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  }
}

function findPullRequestObservations(
  payload: unknown,
  request: ToolRequest,
): PullRequestObservation[] {
  const observations: PullRequestObservation[] = []
  for (const response of pullRequestObjects(payload)) {
    const observation = observationFrom(response, request)
    if (observation) observations.push(observation)
    if (observations.length >= MAX_BATCH_TOOLS) break
  }
  return observations
}

function validExistingAssociation(value: WorkspaceThreadPullRequest): boolean {
  if (typeof value.owner !== 'string' || typeof value.repo !== 'string') return false
  const identity = canonicalGitHubPullRequestUrl(value.url)
  return Boolean(identity
    && identity.owner.toLowerCase() === value.owner.toLowerCase()
    && identity.repo.toLowerCase() === value.repo.toLowerCase()
    && identity.number === value.number
    && typeof value.title === 'string'
    && value.title.length <= 512
    && Number.isFinite(value.observedAt)
    && value.observedAt > 0)
}

function associationKey(value: Pick<WorkspaceThreadPullRequest, 'owner' | 'repo' | 'number'>): string {
  return `${value.owner.toLowerCase()}/${value.repo.toLowerCase()}#${value.number}`
}

function sameAssociation(
  left: WorkspaceThreadPullRequest,
  right: WorkspaceThreadPullRequest,
): boolean {
  return left.owner === right.owner && left.repo === right.repo && left.number === right.number
    && left.title === right.title && left.url === right.url && left.state === right.state
    && left.observedAt === right.observedAt && left.updatedAt === right.updatedAt
}

/**
 * Projects newly completed, structured GitHub pull-request tool evidence onto a
 * conversation's existing associations. Replayed tool parts never refresh the
 * observation timestamp, and reads only refresh an already-associated PR.
 */
export function reduceThreadPullRequests(
  existing: readonly WorkspaceThreadPullRequest[] | undefined,
  previousParts: unknown,
  nextParts: unknown,
  observedAt: number,
): WorkspaceThreadPullRequest[] | undefined {
  const before = completedToolCalls(previousParts)
  const after = completedToolCalls(nextParts)
  const associations = new Map<string, WorkspaceThreadPullRequest>()
  for (const association of existing ?? []) {
    if (!validExistingAssociation(association)) continue
    const key = associationKey(association)
    if (!associations.has(key)) associations.set(key, association)
    if (associations.size >= MAX_PULL_REQUESTS) break
  }

  const existingKeys = new Set(associations.keys())
  const changes: Array<{ observation: PullRequestObservation; operation: PullRequestOperation }> = []
  for (const [toolCallId, call] of after) {
    if (before.get(toolCallId)?.fingerprint === call.fingerprint) continue
    for (const request of requestForCall(call)) {
      for (const payload of mcpPayloads(request.toolOutput)) {
        for (const observation of findPullRequestObservations(payload, request)) {
          changes.push({ observation, operation: request.operation })
        }
      }
    }
  }
  if (changes.length === 0 || !Number.isFinite(observedAt) || observedAt <= 0) {
    return existing as WorkspaceThreadPullRequest[] | undefined
  }

  let changed = false
  for (const { observation, operation } of changes) {
    const key = associationKey(observation)
    const previous = associations.get(key)
    if (operation === 'read' && !existingKeys.has(key)) continue
    if (previous?.state === 'merged' && observation.state !== 'merged') continue
    if (!observation.title && !previous && operation !== 'merge') continue
    if (previous && observation.updatedAt !== undefined && previous.updatedAt !== undefined
      && observation.updatedAt < previous.updatedAt) continue
    const title = observation.title ?? previous?.title ?? `Pull request #${observation.number}`
    const association: WorkspaceThreadPullRequest = {
      owner: observation.owner,
      repo: observation.repo,
      number: observation.number,
      title,
      url: observation.url,
      state: observation.state,
      observedAt,
      ...((observation.updatedAt ?? previous?.updatedAt) === undefined
        ? {}
        : { updatedAt: observation.updatedAt ?? previous?.updatedAt }),
    }
    if (!previous || !sameAssociation(previous, association)) {
      associations.set(key, association)
      changed = true
    }
  }

  if (!changed) return existing as WorkspaceThreadPullRequest[] | undefined
  return [...associations.values()]
    .sort((left, right) => right.observedAt - left.observedAt
      || associationKey(left).localeCompare(associationKey(right)))
    .slice(0, MAX_PULL_REQUESTS)
}
