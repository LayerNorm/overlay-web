import { z } from 'zod/v3'
import { localToolsCapabilitySchema } from './local-tools.js'
export * from './local-tools.js'
export * from './computer-tools.js'
export * from './agent-context.js'
export * from './private-model-relay.js'

/**
 * Contract between Overlay and an Agent Host: enrollment, device-signed host
 * requests, capability advertisement and local tools. The host serves Overlay's
 * own tools on its machine; it runs no third-party agent harness.
 */
export const OVERLAY_AGENT_PROTOCOL_VERSION = 1 as const
export const MAX_HOST_REQUEST_BYTES = 512 * 1024

const identifier = z.string().trim().min(1).max(200)

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

export const hostCapabilitiesSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  localTools: localToolsCapabilitySchema,
  hostVersion: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(200),
  filesystem: filesystemGrantSchema,
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

/** Scopes a host credential carries. Local tools poll with `commands:poll` and answer with `events:write`. */
export const AGENT_HOST_CREDENTIAL_METHODS = [
  'agent:heartbeat',
  'agent:capabilities:update',
  'agent:commands:poll',
  'agent:events:write',
  'agent:credentials:refresh',
] as const
export type AgentHostCredentialMethod = (typeof AGENT_HOST_CREDENTIAL_METHODS)[number]

export const environmentCredentialResponseSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  workspaceId: identifier,
  environmentId: identifier,
  audience: z.literal('overlay-agent-control-plane'),
  methods: z.array(z.enum(AGENT_HOST_CREDENTIAL_METHODS)).min(1),
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
