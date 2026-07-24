import { z } from 'zod'
import type { HostCapabilityOperation, IsolatedProcessRequest } from './agent-infrastructure'

const MAX_INTEGRATION_ARGUMENT_BYTES = 64 * 1024
const MAX_ENVIRONMENT_ENTRIES = 32
const MAX_ENVIRONMENT_BYTES = 16 * 1024

const boundedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\0'), 'nul_not_allowed')

const boundedOptionalText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !value.includes('\0'), 'nul_not_allowed')
    .optional()

const hostCapabilityOperationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('application.search'),
      query: boundedText(256),
      limit: z.number().int().min(1).max(100)
    })
    .strict(),
  z
    .object({
      type: z.literal('application.launch'),
      bundleId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$/)
    })
    .strict(),
  z
    .object({
      type: z.literal('contacts.search'),
      query: boundedText(256),
      limit: z.number().int().min(1).max(100)
    })
    .strict(),
  z
    .object({
      type: z.literal('message.send'),
      recipient: boundedText(512),
      text: boundedText(20_000)
    })
    .strict(),
  z
    .object({
      type: z.literal('reminder.create'),
      title: boundedText(1_000),
      dueAt: z.string().datetime({ offset: true }).optional(),
      listName: boundedOptionalText(512)
    })
    .strict(),
  z
    .object({
      type: z.literal('reminder.list'),
      listName: boundedOptionalText(512),
      limit: z.number().int().min(1).max(500)
    })
    .strict(),
  z
    .object({
      type: z.literal('timer.start'),
      durationSeconds: z
        .number()
        .int()
        .min(1)
        .max(7 * 24 * 60 * 60),
      label: boundedOptionalText(512)
    })
    .strict(),
  z.object({ type: z.literal('accessibility.listApplications') }).strict(),
  z
    .object({
      type: z.literal('accessibility.readTree'),
      pid: z.number().int().positive(),
      bundleId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$/),
      maxDepth: z.number().int().min(1).max(20),
      maxNodes: z.number().int().min(1).max(10_000)
    })
    .strict(),
  z
    .object({
      type: z.literal('accessibility.activateElement'),
      pid: z.number().int().positive(),
      bundleId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$/),
      elementId: boundedText(512),
      expectedRole: boundedText(256),
      expectedTitle: boundedOptionalText(2_000)
    })
    .strict(),
  z
    .object({
      type: z.literal('shortcut.list'),
      limit: z.number().int().min(1).max(500)
    })
    .strict(),
  z
    .object({
      type: z.literal('shortcut.inspect'),
      shortcutId: boundedText(512)
    })
    .strict(),
  z
    .object({
      type: z.literal('shortcut.run'),
      shortcutId: boundedText(512),
      input: boundedOptionalText(20_000)
    })
    .strict(),
  z
    .object({
      type: z.literal('integration.execute'),
      connectionId: boundedText(512),
      toolkit: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
      action: z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/),
      mutation: z.boolean(),
      arguments: z.record(z.string(), z.unknown())
    })
    .strict()
    .superRefine((operation, context) => {
      if (!isBoundedJsonObject(operation.arguments, MAX_INTEGRATION_ARGUMENT_BYTES)) {
        context.addIssue({
          code: 'custom',
          path: ['arguments'],
          message: 'integration_arguments_invalid'
        })
      }
    })
])

const isolatedProcessRequestSchema = z
  .object({
    executable: boundedText(4_096),
    argv: z.array(boundedText(16_384)).max(1_024),
    cwd: boundedText(4_096),
    environment: z.record(z.string(), z.string()),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(10 * 60_000),
    outputLimitBytes: z
      .number()
      .int()
      .min(1_024)
      .max(8 * 1024 * 1024)
  })
  .strict()
  .superRefine((request, context) => {
    const entries = Object.entries(request.environment)
    if (
      entries.length > MAX_ENVIRONMENT_ENTRIES ||
      entries.some(
        ([key, value]) =>
          !/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || value.includes('\0') || value.length > 4_096
      ) ||
      Buffer.byteLength(JSON.stringify(request.environment), 'utf8') > MAX_ENVIRONMENT_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['environment'],
        message: 'isolated_environment_invalid'
      })
    }
  })

export function validateHostCapabilityOperation(input: unknown): HostCapabilityOperation {
  if (
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    (input as { type?: unknown }).type === 'integration.execute' &&
    !isBoundedJsonObject(
      (input as { arguments?: unknown }).arguments,
      MAX_INTEGRATION_ARGUMENT_BYTES
    )
  ) {
    throw new Error('invalid_host_capability_operation')
  }
  const result = hostCapabilityOperationSchema.safeParse(input)
  if (!result.success) throw new Error('invalid_host_capability_operation')
  return result.data as HostCapabilityOperation
}

export function validateIsolatedProcessRequest(input: unknown): IsolatedProcessRequest {
  const result = isolatedProcessRequestSchema.safeParse(input)
  if (!result.success) throw new Error('invalid_isolated_process_request')
  return result.data
}

function isBoundedJsonObject(value: unknown, maxBytes: number): boolean {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    if (!isSafeJsonValue(value, new Set(), 0, { nodes: 0 })) return false
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') <= maxBytes
  } catch {
    return false
  }
}

function isSafeJsonValue(
  value: unknown,
  seen: Set<object>,
  depth: number,
  counter: { nodes: number }
): boolean {
  if (depth > 20 || counter.nodes++ > 10_000) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) {
    if (value.length > 10_000) return false
  } else if (prototype !== Object.prototype && prototype !== null) {
    return false
  }
  seen.add(value)
  try {
    return Object.entries(value).every(
      ([key, entry]) =>
        key !== '__proto__' &&
        key !== 'prototype' &&
        key !== 'constructor' &&
        isSafeJsonValue(entry, seen, depth + 1, counter)
    )
  } finally {
    seen.delete(value)
  }
}
