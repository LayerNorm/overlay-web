import { z } from 'zod'

export const OVERLAY_AGENT_PROTOCOL_VERSION = 1 as const
export const MAX_COMMANDS_PER_POLL = 50
export const MAX_COMMAND_BYTES = 128 * 1024
export const MAX_EVENTS_PER_BATCH = 100
export const MAX_EVENT_BATCH_BYTES = 512 * 1024
export const MAX_HOST_REQUEST_BYTES = 512 * 1024

const identifier = z.string().trim().min(1).max(200)
const jsonObject = z.record(z.string(), z.unknown())

export const filesystemGrantSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('selected_roots'),
    roots: z.array(z.string().trim().min(1)).min(1).max(100),
  }).strict(),
  z.object({
    mode: z.literal('all_user_files'),
  }).strict(),
])
export type FilesystemGrant = z.infer<typeof filesystemGrantSchema>

export const adapterCapabilitySchema = z.object({
  id: identifier,
  displayName: z.string().trim().min(1).max(200),
  protocol: z.enum(['fake', 'acp', 'eve', 'native']),
  version: z.string().trim().min(1).max(100).optional(),
  supports: z.object({
    prompt: z.boolean(),
    approval: z.boolean(),
    cancel: z.boolean(),
    resume: z.boolean(),
  }).strict(),
}).strict()
export type AdapterCapability = z.infer<typeof adapterCapabilitySchema>

export const hostCapabilitiesSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  hostVersion: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(200),
  adapters: z.array(adapterCapabilitySchema).max(100),
  filesystem: filesystemGrantSchema,
  maxConcurrentRuns: z.number().int().positive().max(1_000),
}).strict()
export type HostCapabilities = z.infer<typeof hostCapabilitiesSchema>

export const enrollmentRequestSchema = z.object({
  code: z.string().trim().min(16).max(512),
  name: z.string().trim().min(1).max(200),
  publicKey: z.string().trim().min(64).max(8_192),
  hostVersion: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(200),
  capabilities: hostCapabilitiesSchema,
  kind: z.enum(['local', 'vps', 'external']).default('local'),
}).strict()
export type EnrollmentRequest = z.infer<typeof enrollmentRequestSchema>

export const enrollmentResponseSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  workspaceId: identifier,
  environmentId: identifier,
  verificationPhrase: z.string().trim().min(1).max(200),
  proofChallenge: z.string().trim().min(32).max(512),
  proofChallengeExpiresAt: z.number().int().positive(),
}).strict()
export type EnrollmentResponse = z.infer<typeof enrollmentResponseSchema>

export const initialCredentialRequestSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  proofChallenge: z.string().trim().min(32).max(512),
  signature: z.string().trim().min(32).max(16_384),
}).strict()
export type InitialCredentialRequest = z.infer<typeof initialCredentialRequestSchema>

export const environmentCredentialResponseSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  workspaceId: identifier,
  environmentId: identifier,
  audience: z.literal('overlay-agent-control-plane'),
  methods: z.array(z.enum([
    'agent:heartbeat',
    'agent:capabilities:update',
    'agent:commands:poll',
    'agent:commands:ack',
    'agent:events:write',
    'agent:credentials:refresh',
  ])).min(1),
  token: z.string().trim().min(32).max(512),
  expiresAt: z.number().int().positive(),
  filesystemGrant: filesystemGrantSchema,
}).strict()
export type EnvironmentCredentialResponse = z.infer<typeof environmentCredentialResponseSchema>

export const hostRequestProofHeadersSchema = z.object({
  timestamp: z.string().regex(/^\d{13}$/),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22,128}$/),
  signature: z.string().trim().min(32).max(16_384),
}).strict()
export type HostRequestProofHeaders = z.infer<typeof hostRequestProofHeadersSchema>

export function canonicalEnrollmentProof(environmentId: string, proofChallenge: string): string {
  return ['overlay-agent-enrollment-v1', environmentId, proofChallenge].join('\n')
}

export function canonicalHostRequestProof(input: {
  method: string
  pathname: string
  timestamp: string
  nonce: string
  bodySha256: string
  tokenSha256: string
}): string {
  return [
    'overlay-agent-request-v1',
    input.method.toUpperCase(),
    input.pathname,
    input.timestamp,
    input.nonce,
    input.bodySha256,
    input.tokenSha256,
  ].join('\n')
}

const commandBase = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  commandId: identifier,
  environmentId: identifier,
  workspaceId: identifier,
  runId: identifier,
  sequence: z.number().int().positive(),
  issuedAt: z.number().int().nonnegative(),
})

const sessionCommand = {
  bindingId: identifier,
  adapterId: identifier,
  workingDirectory: z.string().trim().min(1),
}

export const agentHostCommandSchema = z.discriminatedUnion('type', [
  commandBase.extend({
    type: z.literal('start'),
    payload: z.object({ ...sessionCommand, prompt: z.string(), sessionId: identifier.optional(), metadata: jsonObject.default({}) }).strict(),
  }).strict(),
  commandBase.extend({
    type: z.literal('prompt'),
    payload: z.object({ prompt: z.string() }).strict(),
  }).strict(),
  commandBase.extend({
    type: z.literal('approval_response'),
    payload: z.object({ requestKey: identifier, optionId: identifier }).strict(),
  }).strict(),
  commandBase.extend({ type: z.literal('cancel'), payload: z.object({ reason: z.string().max(2_000).optional() }).strict() }).strict(),
  commandBase.extend({ type: z.literal('reconnect'), payload: z.object({ remoteSessionId: identifier }).strict() }).strict(),
  commandBase.extend({ type: z.literal('shutdown'), payload: z.object({ reason: z.string().max(2_000).optional() }).strict() }).strict(),
])
export type AgentHostCommand = z.infer<typeof agentHostCommandSchema>

export const commandPollResponseSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  commands: z.array(agentHostCommandSchema).max(MAX_COMMANDS_PER_POLL),
  retryAfterMs: z.number().int().min(100).max(60_000).optional(),
}).strict().superRefine((response, context) => {
  for (let index = 0; index < response.commands.length; index += 1) {
    if (new TextEncoder().encode(JSON.stringify(response.commands[index])).byteLength > MAX_COMMAND_BYTES) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['commands', index], message: 'command exceeds byte limit' })
    }
  }
})
export type CommandPollResponse = z.infer<typeof commandPollResponseSchema>

export const commandAcknowledgementSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  commandId: identifier,
  environmentId: identifier,
  accepted: z.boolean(),
  error: z.object({ code: identifier, message: z.string().max(2_000) }).strict().optional(),
}).strict()
export type CommandAcknowledgement = z.infer<typeof commandAcknowledgementSchema>

const eventBase = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  eventId: identifier,
  environmentId: identifier,
  runId: identifier,
  sourceSequence: z.number().int().positive(),
  occurredAt: z.number().int().nonnegative(),
})

export const agentHostEventSchema = z.discriminatedUnion('type', [
  eventBase.extend({ type: z.literal('session_started'), payload: z.object({ remoteSessionId: identifier, adapterId: identifier }).strict() }).strict(),
  eventBase.extend({ type: z.literal('text_checkpoint'), payload: z.object({ text: z.string(), final: z.boolean().optional() }).strict() }).strict(),
  eventBase.extend({ type: z.literal('action'), payload: z.object({ actionId: identifier, title: z.string().max(2_000), status: z.enum(['started', 'updated', 'completed', 'failed']), detail: z.string().max(20_000).optional() }).strict() }).strict(),
  eventBase.extend({ type: z.literal('approval_requested'), payload: z.object({ requestKey: identifier, prompt: z.string().max(20_000), options: z.array(z.object({ id: identifier, label: z.string().max(500) }).strict()).min(1).max(20), context: jsonObject.default({}) }).strict() }).strict(),
  eventBase.extend({ type: z.literal('artifact'), payload: z.object({ name: z.string().min(1).max(500), mediaType: z.string().min(1).max(200), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/), uploadReference: identifier }).strict() }).strict(),
  eventBase.extend({ type: z.literal('completed'), payload: z.object({ summary: z.string().max(20_000).optional(), usage: jsonObject.default({}) }).strict() }).strict(),
  eventBase.extend({ type: z.literal('failed'), payload: z.object({ code: identifier, message: z.string().max(20_000), retryable: z.boolean() }).strict() }).strict(),
  eventBase.extend({ type: z.literal('cancelled'), payload: z.object({ reason: z.string().max(2_000).optional() }).strict() }).strict(),
])
export type AgentHostEvent = z.infer<typeof agentHostEventSchema>

export const eventBatchSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  environmentId: identifier,
  runId: identifier,
  events: z.array(agentHostEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
}).strict().superRefine((batch, context) => {
  for (let index = 0; index < batch.events.length; index += 1) {
    const current = batch.events[index]
    if (current.environmentId !== batch.environmentId || current.runId !== batch.runId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['events', index], message: 'event scope must match batch scope' })
    }
    if (index > 0 && current.sourceSequence !== batch.events[index - 1].sourceSequence + 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['events', index, 'sourceSequence'], message: 'event sequences must be contiguous' })
    }
  }
  if (new TextEncoder().encode(JSON.stringify(batch)).byteLength > MAX_EVENT_BATCH_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['events'], message: 'event batch exceeds byte limit' })
  }
})
export type EventBatch = z.infer<typeof eventBatchSchema>

export const eventAcknowledgementSchema = z.discriminatedUnion('accepted', [
  z.object({ protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION), accepted: z.literal(true), acknowledgedSequence: z.number().int().nonnegative() }).strict(),
  z.object({ protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION), accepted: z.literal(false), expectedSequence: z.number().int().positive() }).strict(),
])
export type EventAcknowledgement = z.infer<typeof eventAcknowledgementSchema>
