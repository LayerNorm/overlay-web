import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'

const MAX_APPROVAL_TTL_MS = 10 * 60_000
const DEFAULT_APPROVAL_TTL_MS = 2 * 60_000
const MAX_CANONICAL_ACTION_BYTES = 64 * 1024

export interface ApprovalBindingContext {
  readonly taskId: string
  readonly principalId: string
  readonly serverDeploymentId: string
}

export interface ApprovalRequest {
  readonly id: string
  readonly toolName: string
  readonly display: Readonly<Record<string, unknown>>
  readonly digest: string
  readonly issuedAt: number
  readonly expiresAt: number
}

interface StoredApproval {
  digest: string
  expiresAt: number
  state: 'pending' | 'approved' | 'consumed'
}

export class AgentApprovalStore {
  private readonly approvals = new Map<string, StoredApproval>()

  create(
    context: ApprovalBindingContext,
    toolName: string,
    canonicalArguments: unknown,
    options: { now?: number; ttlMs?: number } = {}
  ): ApprovalRequest {
    validateBindingContext(context)
    if (!/^[A-Za-z0-9_:-]{2,160}$/.test(toolName)) {
      throw new Error('invalid_approval_tool_name')
    }
    const issuedAt = options.now ?? Date.now()
    const ttlMs = options.ttlMs ?? DEFAULT_APPROVAL_TTL_MS
    if (!Number.isFinite(issuedAt) || !Number.isFinite(ttlMs) || ttlMs < 1_000) {
      throw new Error('invalid_approval_timing')
    }
    const expiresAt = issuedAt + Math.min(ttlMs, MAX_APPROVAL_TTL_MS)
    const id = randomUUID()
    const canonicalAction = canonicalize(canonicalArguments, new Set(), 0)
    if (!canonicalAction || typeof canonicalAction !== 'object' || Array.isArray(canonicalAction)) {
      throw new Error('approval_action_must_be_object')
    }
    const digest = digestApproval(id, context, toolName, canonicalAction, expiresAt)
    this.approvals.set(id, { digest, expiresAt, state: 'pending' })
    return Object.freeze({
      id,
      toolName,
      display: deepFreeze(canonicalAction as Record<string, unknown>),
      digest,
      issuedAt,
      expiresAt
    })
  }

  approve(id: string, now = Date.now()): boolean {
    const approval = this.approvals.get(id)
    if (!approval || approval.state !== 'pending' || approval.expiresAt <= now) {
      this.approvals.delete(id)
      return false
    }
    approval.state = 'approved'
    return true
  }

  consume(
    id: string,
    context: ApprovalBindingContext,
    toolName: string,
    canonicalArguments: unknown,
    now = Date.now()
  ): boolean {
    const approval = this.approvals.get(id)
    if (!approval || approval.state !== 'approved' || approval.expiresAt <= now) {
      this.approvals.delete(id)
      return false
    }
    const actualDigest = digestApproval(
      id,
      context,
      toolName,
      canonicalArguments,
      approval.expiresAt
    )
    const expected = Buffer.from(approval.digest, 'hex')
    const actual = Buffer.from(actualDigest, 'hex')
    if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) {
      return false
    }
    approval.state = 'consumed'
    this.approvals.delete(id)
    return true
  }

  revoke(id: string): boolean {
    return this.approvals.delete(id)
  }

  revokeAll(): void {
    this.approvals.clear()
  }

  pruneExpired(now = Date.now()): number {
    let removed = 0
    for (const [id, approval] of this.approvals) {
      if (approval.expiresAt <= now) {
        this.approvals.delete(id)
        removed += 1
      }
    }
    return removed
  }
}

function digestApproval(
  id: string,
  context: ApprovalBindingContext,
  toolName: string,
  canonicalArguments: unknown,
  expiresAt: number
): string {
  const action = canonicalJson({
    version: 1,
    id,
    taskId: context.taskId,
    principalId: context.principalId,
    serverDeploymentId: context.serverDeploymentId,
    toolName,
    canonicalArguments,
    expiresAt
  })
  if (Buffer.byteLength(action, 'utf8') > MAX_CANONICAL_ACTION_BYTES) {
    throw new Error('approval_action_too_large')
  }
  return createHash('sha256').update(action, 'utf8').digest('hex')
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set(), 0))
}

function canonicalize(value: unknown, seen: Set<object>, depth: number): unknown {
  if (depth > 20) throw new Error('approval_action_too_deep')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('approval_action_invalid_number')
    return Object.is(value, -0) ? 0 : value
  }
  if (
    value === undefined ||
    typeof value === 'bigint' ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    throw new Error('approval_action_not_serializable')
  }
  if (typeof value !== 'object') throw new Error('approval_action_not_serializable')
  if (seen.has(value)) throw new Error('approval_action_cycle')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > 10_000) throw new Error('approval_action_too_wide')
      return value.map((entry) => canonicalize(entry, seen, depth + 1))
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('approval_action_non_plain_object')
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    )
    if (entries.length > 10_000) throw new Error('approval_action_too_wide')
    const result: Record<string, unknown> = {}
    for (const [key, entry] of entries) {
      if (!key || key.length > 512) throw new Error('approval_action_invalid_key')
      result[key] = canonicalize(entry, seen, depth + 1)
    }
    return result
  } finally {
    seen.delete(value)
  }
}

function validateBindingContext(context: ApprovalBindingContext): void {
  for (const value of [context.taskId, context.principalId, context.serverDeploymentId]) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
      throw new Error('invalid_approval_context')
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      deepFreeze(entry)
    }
    Object.freeze(value)
  }
  return value
}

export const agentApprovalStore = new AgentApprovalStore()
