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

/** A host asks for the provider credentials of one run; the secret is never part of a stored command. */
export const runCredentialsRequestSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  runId: identifier,
}).strict()
export type RunCredentialsRequest = z.infer<typeof runCredentialsRequestSchema>

export const runCredentialsResponseSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  /** Environment variables for the agent process of this run only. */
  env: z.record(z.string().min(1).max(128), z.string().min(1).max(8_192)),
}).strict()
export type RunCredentialsResponse = z.infer<typeof runCredentialsResponseSchema>

export const enrollmentRequestSchema = z.object({
  code: z.string().trim().min(16).max(512),
  name: z.string().trim().min(1).max(200),
  publicKey: z.string().trim().min(64).max(8_192),
  hostVersion: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(200),
  capabilities: hostCapabilitiesSchema,
  kind: z.enum(['local', 'vps', 'overlay_cloud', 'external']).default('local'),
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
    'agent:artifacts:write',
    'agent:credentials:refresh',
    'agent:run-credentials',
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
    payload: z.object({ ...sessionCommand, prompt: z.string(), sessionId: identifier.optional(), fresh: z.boolean().optional(), metadata: jsonObject.default({}) }).strict(),
  }).strict(),
  commandBase.extend({
    type: z.literal('prompt'),
    payload: z.object({ prompt: z.string() }).strict(),
  }).strict(),
  commandBase.extend({
    type: z.literal('approval_response'),
    payload: z.object({ requestKey: identifier, optionId: identifier }).strict(),
  }).strict(),
  commandBase.extend({
    type: z.literal('elicitation_response'),
    payload: z.object({ requestKey: identifier, action: z.enum(['accept', 'decline', 'cancel']), content: jsonObject.optional() }).strict(),
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
  eventBase.extend({ type: z.literal('elicitation_requested'), payload: z.object({ requestKey: identifier, prompt: z.string().max(20_000), requestedSchema: jsonObject, context: jsonObject.default({}) }).strict() }).strict(),
  eventBase.extend({ type: z.literal('plan'), payload: z.object({ entries: z.array(z.object({ id: identifier, title: z.string().max(2_000), status: z.enum(['pending', 'in_progress', 'completed', 'failed']) }).strict()).max(100) }).strict() }).strict(),
  eventBase.extend({ type: z.literal('commands_update'), payload: z.object({ commands: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2_000).optional(),
    inputHint: z.string().max(500).optional(),
  }).strict()).max(100) }).strict() }).strict(),
  eventBase.extend({ type: z.literal('diff'), payload: z.object({ diffId: identifier, title: z.string().max(2_000), patch: z.string().max(200_000), language: z.string().max(100).optional() }).strict() }).strict(),
  eventBase.extend({ type: z.literal('terminal'), payload: z.object({ terminalId: identifier, title: z.string().max(2_000), summary: z.string().max(20_000), exitCode: z.number().int().optional(), status: z.enum(['running', 'completed', 'failed']) }).strict() }).strict(),
  eventBase.extend({ type: z.literal('artifact'), payload: z.object({ name: z.string().min(1).max(500), mediaType: z.string().min(1).max(200), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/), uploadReference: identifier }).strict() }).strict(),
  eventBase.extend({ type: z.literal('completed'), payload: z.object({ summary: z.string().max(20_000).optional(), usage: jsonObject.default({}) }).strict() }).strict(),
  eventBase.extend({ type: z.literal('failed'), payload: z.object({ code: identifier, message: z.string().max(20_000), retryable: z.boolean() }).strict() }).strict(),
  eventBase.extend({ type: z.literal('cancelled'), payload: z.object({ reason: z.string().max(2_000).optional() }).strict() }).strict(),
])
export type AgentHostEvent = z.infer<typeof agentHostEventSchema>

export const artifactUploadRequestSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  runId: identifier,
  name: z.string().trim().min(1).max(500),
  mediaType: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type ArtifactUploadRequest = z.infer<typeof artifactUploadRequestSchema>

export const artifactUploadResponseSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  artifactId: identifier,
  uploadReference: identifier,
  uploadUrl: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  expiresAt: z.number().int().positive(),
}).strict()
export type ArtifactUploadResponse = z.infer<typeof artifactUploadResponseSchema>

export const artifactCompleteRequestSchema = z.object({
  protocolVersion: z.literal(OVERLAY_AGENT_PROTOCOL_VERSION),
  uploadReference: identifier,
}).strict()

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

// ---- Agent profiles (imported Claude Code / Codex config) ----
/**
 * Agent profiles: the part of a person's Claude Code or Codex setup that can move to an agent on Overlay Cloud
 * (instructions, skills, commands, subagents, MCP servers), and the rules that decide what may leave their computer.
 *
 * This module is pure and shared. The Agent Host runs it on the person's own machine so secrets are removed
 * before anything is uploaded, and Overlay runs it again on receipt, so a modified or older client cannot
 * smuggle one in. Nothing here reads the file system: callers pass in text files and get back what is safe.
 */

export const AGENT_PROFILE_HARNESSES = ['claude-code', 'codex'] as const
export type AgentProfileHarness = (typeof AGENT_PROFILE_HARNESSES)[number]

export function isAgentProfileHarness(value: unknown): value is AgentProfileHarness {
  return typeof value === 'string' && (AGENT_PROFILE_HARNESSES as readonly string[]).includes(value)
}

export const AGENT_PROFILE_LIMITS = {
  maxFiles: 3_000,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
  maxPathLength: 300,
} as const

/** A text file, with a path relative to the harness's config folder (`~/.claude` or `~/.codex`). `claude.json` stands for `~/.claude.json`. */
export type AgentProfileFile = { path: string; content: string }

export type ProfileDrop = { path: string; reason: string }
/** A value removed from the profile that the agent needs again at run time (an MCP server's token, for example). */
export type ProfileSecretNeed = { name: string; usedBy: string }
/** Something that runs a command on the machine; kept out of the applied profile until the person turns it on. */
export type ProfileHook = { kind: 'hook' | 'notify' | 'statusline'; event: string; command: string }
export type ProfileWarning = { path: string; message: string }
export type ProfileMcpServers = Record<string, Record<string, unknown>>

export type AnalyzedProfile = {
  harness: AgentProfileHarness
  /** Safe to store and to write to a machine. */
  files: AgentProfileFile[]
  /** Claude Code MCP servers, with secret values replaced by `${NAME}` placeholders listed in `secrets`. */
  mcpServers: ProfileMcpServers
  hooks: ProfileHook[]
  secrets: ProfileSecretNeed[]
  dropped: ProfileDrop[]
  /** Files where secret-looking text was replaced with `[REDACTED]`. */
  redactions: Array<{ path: string; count: number }>
  warnings: ProfileWarning[]
}

const SECRET_TEXT_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /xox[abprs]-[A-Za-z0-9-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{30,}/g,
]

const SECRET_NAME = /(?:^|[_-])(?:key|token|secret|password|passwd|pass|auth|authorization|credential|credentials|cookie)(?:$|[_-])|apikey|api_key/i

/** A value that is, or contains, a credential: a known token shape, or a long unbroken high-entropy string. */
export function looksLikeSecret(value: string): boolean {
  const text = value.trim()
  if (!text) return false
  for (const pattern of SECRET_TEXT_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(text)) return true
  }
  // Long, no spaces, mixed letters and digits: an opaque token rather than a word, a path, or a URL.
  return text.length >= 28 && /^[A-Za-z0-9_\-+/=.]+$/.test(text) && /[A-Za-z]/.test(text) && /\d/.test(text) && !text.includes('/')
}

/** Replaces secret-looking text; returns the cleaned text and how many replacements were made. */
export function redactSecretText(text: string): { text: string; count: number } {
  let count = 0
  let out = text
  for (const pattern of SECRET_TEXT_PATTERNS) {
    pattern.lastIndex = 0
    out = out.replace(pattern, () => { count += 1; return '[REDACTED]' })
  }
  return { text: out, count }
}

/** Environment-variable style name for a secret value: `GITHUB_TOKEN`, or `SERVER_HEADER` when nothing better is known. */
export function secretEnvName(...parts: string[]): string {
  const name = parts.join('_').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[A-Z_]/.test(name) ? name : `S_${name}`
}

const DENIED_SEGMENT = /^(?:\.env(?:\..*)?|\.git|node_modules|\.credentials\.json|credentials\.json|auth\.json|\.netrc|id_(?:rsa|ed25519|ecdsa)(?:\.pub)?|.*\.(?:pem|key|p12|pfx|keychain))$/i

type Rule = { test: (path: string) => boolean; sanitize?: 'settings' | 'codex-config' | 'mcp-source' | 'text' }

const CLAUDE_RULES: Rule[] = [
  { test: (p) => p === 'CLAUDE.md', sanitize: 'text' },
  { test: (p) => p === 'settings.json', sanitize: 'settings' },
  { test: (p) => p === 'claude.json', sanitize: 'mcp-source' },
  { test: (p) => /^agents\/.+\.md$/.test(p), sanitize: 'text' },
  { test: (p) => /^commands\/.+\.md$/.test(p), sanitize: 'text' },
  { test: (p) => /^output-styles\/.+\.md$/.test(p), sanitize: 'text' },
  { test: (p) => p.startsWith('skills/') && p.length > 'skills/'.length, sanitize: 'text' },
]

const CODEX_RULES: Rule[] = [
  { test: (p) => p === 'AGENTS.md', sanitize: 'text' },
  { test: (p) => p === 'config.toml', sanitize: 'codex-config' },
  { test: (p) => /^prompts\/.+\.md$/.test(p), sanitize: 'text' },
  { test: (p) => p.startsWith('skills/') && p.length > 'skills/'.length, sanitize: 'text' },
]

/** Why a path is not part of the import, for the paths a person's folder upload contained. */
const NOT_IMPORTED: Array<{ test: (path: string) => boolean; reason: string }> = [
  { test: (p) => /^(?:\.credentials\.json|auth\.json)$/.test(p), reason: 'Sign-in credentials are never imported.' },
  { test: (p) => p.startsWith('plugins/'), reason: 'Plugins are not imported; their skills and commands are not copied.' },
  { test: (p) => p.startsWith('hooks/'), reason: 'Hook scripts run code; they are not imported.' },
  { test: (p) => /^(?:projects|sessions|history|file-history|shell-snapshots|todos|statsig|telemetry|debug|cache|downloads|ide|paste-cache|session-env|backups|state)(?:\/|\.|$)/.test(p), reason: 'Conversation history, caches, and local state are not imported.' },
]

function normalizePath(path: string): string | null {
  const unified = path.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!unified || unified.length > AGENT_PROFILE_LIMITS.maxPathLength) return null
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified) || unified.includes('\0')) return null
  const segments = unified.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  return segments.join('/')
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch (_error) {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const LOCAL_PATH = /^(?:\/Users\/|\/home\/|~\/|[A-Za-z]:[\\/])/

class Collector {
  readonly files: AgentProfileFile[] = []
  readonly dropped: ProfileDrop[] = []
  readonly redactions: Array<{ path: string; count: number }> = []
  readonly secrets = new Map<string, ProfileSecretNeed>()
  readonly hooks: ProfileHook[] = []
  readonly warnings: ProfileWarning[] = []
  mcpServers: ProfileMcpServers = {}

  drop(path: string, reason: string) { this.dropped.push({ path, reason }) }
  need(name: string, usedBy: string) { if (!this.secrets.has(name)) this.secrets.set(name, { name, usedBy }) }
}

const SETTINGS_DROPPED_KEYS: Record<string, string> = {
  env: 'Environment values can hold credentials.',
  apiKeyHelper: 'Runs a command to fetch a credential.',
  awsAuthRefresh: 'Runs a command to refresh credentials.',
  awsCredentialExport: 'Runs a command to export credentials.',
  otelHeadersHelper: 'Runs a command to produce telemetry headers.',
  forceLoginMethod: 'Sign-in is set up separately on Overlay.',
  forceLoginOrgUUID: 'Sign-in is set up separately on Overlay.',
  enabledPlugins: 'Plugins are not imported.',
  extraKnownMarketplaces: 'Plugins are not imported.',
  skipDangerousModePermissionPrompt: 'Overlay asks for approval itself.',
}

function sanitizeSettings(collector: Collector, path: string, text: string): AgentProfileFile | null {
  const parsed = safeJson(text)
  if (!parsed) { collector.drop(path, 'Not valid JSON.'); return null }
  const settings: Record<string, unknown> = { ...parsed }
  for (const [key, reason] of Object.entries(SETTINGS_DROPPED_KEYS)) {
    if (key in settings) { delete settings[key]; collector.drop(`${path}: ${key}`, reason) }
  }
  // Overlay's approval cards are the permission prompt for a cloud agent. A mode that skips the prompt (bypass,
  // accept edits) would sidestep them, and one that denies whatever is not pre-approved (don't ask) would silently
  // refuse every tool, so only the modes that ask are imported.
  if (isRecord(settings.permissions) && typeof settings.permissions.defaultMode === 'string'
    && !['default', 'plan'].includes(settings.permissions.defaultMode)) {
    const { defaultMode: _mode, ...rest } = settings.permissions
    settings.permissions = rest
    collector.drop(`${path}: permissions.defaultMode`, 'Overlay asks for approval itself, so a mode that skips or denies the prompt is not imported.')
  }
  if (isRecord(settings.hooks)) {
    for (const [event, groups] of Object.entries(settings.hooks)) {
      for (const group of Array.isArray(groups) ? groups : []) {
        for (const hook of isRecord(group) && Array.isArray(group.hooks) ? group.hooks : []) {
          if (isRecord(hook) && typeof hook.command === 'string') collector.hooks.push({ kind: 'hook', event, command: hook.command.slice(0, 500) })
        }
      }
    }
    delete settings.hooks
  }
  if (isRecord(settings.statusLine) && typeof settings.statusLine.command === 'string') {
    collector.hooks.push({ kind: 'statusline', event: 'statusLine', command: settings.statusLine.command.slice(0, 500) })
    delete settings.statusLine
  }
  if (isRecord(settings.mcpServers)) {
    absorbMcpServers(collector, settings.mcpServers)
    delete settings.mcpServers
  }
  // Anything left that is, or contains, a credential goes too.
  const scrub = (value: unknown, trail: string): unknown => {
    if (typeof value === 'string') {
      if (looksLikeSecret(value)) { collector.drop(`${path}: ${trail}`, 'Looks like a credential.'); return undefined }
      return value
    }
    if (Array.isArray(value)) return value.map((entry, index) => scrub(entry, `${trail}[${index}]`)).filter((entry) => entry !== undefined)
    if (isRecord(value)) {
      const out: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value)) {
        const cleaned = scrub(entry, trail ? `${trail}.${key}` : key)
        if (cleaned !== undefined) out[key] = cleaned
      }
      return out
    }
    return value
  }
  const cleaned = scrub(settings, '') as Record<string, unknown>
  return { path, content: `${JSON.stringify(cleaned, null, 2)}\n` }
}

function placeholder(name: string): string {
  return `\${${name}}`
}

function absorbMcpServers(collector: Collector, servers: Record<string, unknown>) {
  for (const [name, raw] of Object.entries(servers)) {
    if (!isRecord(raw) || !/^[A-Za-z0-9_.-]{1,64}$/.test(name)) { collector.drop(`MCP server ${name}`, 'Unreadable or unsupported entry.'); continue }
    const server: Record<string, unknown> = { ...raw }
    // Keep only fields Claude Code defines for a server; anything else is dropped rather than copied.
    for (const key of Object.keys(server)) {
      if (!['type', 'command', 'args', 'env', 'url', 'headers'].includes(key)) delete server[key]
    }
    if (isRecord(server.env)) {
      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(server.env)) {
        if (typeof value !== 'string') continue
        if (SECRET_NAME.test(key) || looksLikeSecret(value)) {
          const envName = secretEnvName(key)
          env[key] = placeholder(envName)
          collector.need(envName, name)
        } else env[key] = value
      }
      server.env = env
    }
    if (isRecord(server.headers)) {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(server.headers)) {
        if (typeof value !== 'string') continue
        if (SECRET_NAME.test(key) || looksLikeSecret(value)) {
          const envName = secretEnvName(name, key)
          const scheme = /^(Bearer|Basic|Token)\s+/i.exec(value)
          headers[key] = `${scheme ? `${scheme[1]} ` : ''}${placeholder(envName)}`
          collector.need(envName, name)
        } else headers[key] = value
      }
      server.headers = headers
    }
    if (Array.isArray(server.args)) {
      server.args = server.args.map((arg, index) => {
        if (typeof arg !== 'string') return arg
        if (looksLikeSecret(arg)) {
          const envName = secretEnvName(name, 'ARG', String(index))
          collector.need(envName, name)
          return placeholder(envName)
        }
        return arg
      })
    }
    if (typeof server.url === 'string') {
      try {
        const url = new URL(server.url)
        for (const [key, value] of [...url.searchParams.entries()]) {
          if (SECRET_NAME.test(key) || looksLikeSecret(value)) {
            const envName = secretEnvName(name, key)
            url.searchParams.set(key, placeholder(envName))
            collector.need(envName, name)
          }
        }
        // URL.toString percent-encodes the braces of a placeholder; restore them so Claude Code can expand it.
        server.url = url.toString().replace(/%24%7B([A-Z0-9_]+)%7D/g, '${$1}')
      } catch (_error) {
        collector.drop(`MCP server ${name}`, 'Its URL could not be read.')
        continue
      }
    }
    if (typeof server.command === 'string' && LOCAL_PATH.test(server.command)) {
      collector.warnings.push({ path: `MCP server ${name}`, message: 'Its command points at a path on your computer, which will not exist on the agent\'s machine.' })
    }
    collector.mcpServers[name] = server
  }
}

function sanitizeCodexConfig(collector: Collector, path: string, text: string): AgentProfileFile | null {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let table = ''
  let skipTable = false
  for (const line of lines) {
    const header = /^\s*\[{1,2}\s*([^\]]+?)\s*\]{1,2}\s*$/.exec(line)
    if (header) {
      table = header[1]!
      skipTable = /^projects(\.|$)/.test(table)
      if (skipTable) collector.drop(`${path}: [${table}]`, 'Trusted project paths belong to your computer.')
      if (!skipTable) out.push(line)
      continue
    }
    if (skipTable) continue
    const entry = /^\s*([A-Za-z0-9_."-]+)\s*=\s*(.*)$/.exec(line)
    if (entry) {
      const key = entry[1]!
      const value = entry[2]!
      if (key === 'notify') {
        collector.hooks.push({ kind: 'notify', event: 'notify', command: value.slice(0, 500) })
        continue
      }
      const isEnvName = /(?:_env|env_key|_env_var|env_vars)$/i.test(key)
      const secretKey = SECRET_NAME.test(key) && !isEnvName
      if (secretKey || looksLikeSecret(value.replace(/^["']|["']$/g, ''))) {
        collector.drop(`${path}: ${table ? `${table}.` : ''}${key}`, 'Looks like a credential; Codex cannot receive it yet.')
        continue
      }
    }
    out.push(line)
  }
  return { path, content: `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n` }
}

/**
 * Applies the import rules to a set of files (from a person's `~/.claude` or `~/.codex`): what is allowed in, with
 * secrets removed and a record of what was left out and why.
 */
export function analyzeAgentProfile(harness: AgentProfileHarness, input: readonly AgentProfileFile[]): AnalyzedProfile {
  const collector = new Collector()
  const rules = harness === 'claude-code' ? CLAUDE_RULES : CODEX_RULES
  let total = 0
  const seen = new Set<string>()
  for (const file of input) {
    const path = typeof file?.path === 'string' ? normalizePath(file.path) : null
    if (!path) { collector.drop(String(file?.path ?? '(no path)').slice(0, 120), 'Not a valid relative path.'); continue }
    if (seen.has(path)) { collector.drop(path, 'Listed twice.'); continue }
    seen.add(path)
    const notImported = NOT_IMPORTED.find((entry) => entry.test(path))
    if (notImported) { collector.drop(path, notImported.reason); continue }
    const rule = rules.find((candidate) => candidate.test(path))
    if (!rule) { collector.drop(path, 'Not part of what an agent imports.'); continue }
    if (path.split('/').some((segment) => DENIED_SEGMENT.test(segment))) { collector.drop(path, 'Looks like a credential or a dependency folder.'); continue }
    if (typeof file.content !== 'string') { collector.drop(path, 'Not text.'); continue }
    if (file.content.includes('\0')) { collector.drop(path, 'Binary file.'); continue }
    const bytes = new TextEncoder().encode(file.content).length
    if (bytes > AGENT_PROFILE_LIMITS.maxFileBytes) { collector.drop(path, `Larger than ${AGENT_PROFILE_LIMITS.maxFileBytes / 1024} KB.`); continue }
    if (collector.files.length >= AGENT_PROFILE_LIMITS.maxFiles) { collector.drop(path, `More than ${AGENT_PROFILE_LIMITS.maxFiles} files.`); continue }
    if (total + bytes > AGENT_PROFILE_LIMITS.maxTotalBytes) { collector.drop(path, 'The import is over its total size limit.'); continue }

    if (rule.sanitize === 'mcp-source') {
      const parsed = safeJson(file.content)
      if (!parsed) { collector.drop(path, 'Not valid JSON.'); continue }
      if (isRecord(parsed.mcpServers)) absorbMcpServers(collector, parsed.mcpServers)
      // The rest of ~/.claude.json is account and project state: never imported.
      continue
    }
    let cleaned: AgentProfileFile | null
    if (rule.sanitize === 'settings') cleaned = sanitizeSettings(collector, path, file.content)
    else if (rule.sanitize === 'codex-config') cleaned = sanitizeCodexConfig(collector, path, file.content)
    else {
      const redacted = redactSecretText(file.content)
      if (redacted.count > 0) collector.redactions.push({ path, count: redacted.count })
      cleaned = { path, content: redacted.text }
    }
    if (!cleaned) continue
    total += new TextEncoder().encode(cleaned.content).length
    collector.files.push(cleaned)
  }
  return {
    harness,
    files: collector.files,
    mcpServers: collector.mcpServers,
    hooks: collector.hooks,
    secrets: [...collector.secrets.values()],
    dropped: collector.dropped,
    redactions: collector.redactions,
    warnings: collector.warnings,
  }
}

/** What the person is shown before applying: counts by kind instead of one row per file. */
export type ProfileSummary = {
  claudeMd: boolean
  agentsMd: boolean
  settings: boolean
  skills: number
  skillFiles: number
  commands: number
  subagents: number
  outputStyles: number
  prompts: number
  mcpServers: number
  hooks: number
  secrets: number
  dropped: number
  files: number
  bytes: number
}

export function summarizeAgentProfile(profile: Pick<AnalyzedProfile, 'files' | 'mcpServers' | 'hooks' | 'secrets' | 'dropped'>): ProfileSummary {
  const skillNames = new Set<string>()
  let skillFiles = 0
  let commands = 0
  let subagents = 0
  let outputStyles = 0
  let prompts = 0
  let bytes = 0
  for (const file of profile.files) {
    bytes += new TextEncoder().encode(file.content).length
    if (file.path.startsWith('skills/')) { skillFiles += 1; skillNames.add(file.path.split('/')[1] ?? '') }
    else if (file.path.startsWith('commands/')) commands += 1
    else if (file.path.startsWith('agents/')) subagents += 1
    else if (file.path.startsWith('output-styles/')) outputStyles += 1
    else if (file.path.startsWith('prompts/')) prompts += 1
  }
  return {
    claudeMd: profile.files.some((file) => file.path === 'CLAUDE.md'),
    agentsMd: profile.files.some((file) => file.path === 'AGENTS.md'),
    settings: profile.files.some((file) => file.path === 'settings.json' || file.path === 'config.toml'),
    skills: skillNames.size, skillFiles, commands, subagents, outputStyles, prompts,
    mcpServers: Object.keys(profile.mcpServers).length,
    hooks: profile.hooks.length,
    secrets: profile.secrets.length,
    dropped: profile.dropped.length,
    files: profile.files.length,
    bytes,
  }
}

/** The bundle a profile is stored as and applied from. */
export type AgentProfileBundle = {
  version: 1
  harness: AgentProfileHarness
  files: AgentProfileFile[]
  mcpServers: ProfileMcpServers
  hooks: ProfileHook[]
  secrets: ProfileSecretNeed[]
}

export function bundleFromAnalysis(profile: AnalyzedProfile): AgentProfileBundle {
  return { version: 1, harness: profile.harness, files: profile.files, mcpServers: profile.mcpServers, hooks: profile.hooks, secrets: profile.secrets }
}

/** What a client uploads: raw files from a folder, or what a host already cleaned plus the pieces cleaning removes. */
export type AgentProfileUpload = {
  harness: AgentProfileHarness
  files: AgentProfileFile[]
  mcpServers?: ProfileMcpServers
  hooks?: ProfileHook[]
  secrets?: ProfileSecretNeed[]
}

const SECRET_ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/

/**
 * Runs the import rules over an upload. The receiving side calls this whatever the sender claims to have cleaned:
 * files and servers are analyzed again, and the hooks and secret names a host reports are accepted only in a bounded,
 * validated form.
 */
export function analyzeAgentProfileUpload(upload: AgentProfileUpload): AnalyzedProfile {
  const input = [...upload.files]
  if (upload.harness === 'claude-code' && upload.mcpServers && Object.keys(upload.mcpServers).length > 0) {
    input.push({ path: 'claude.json', content: JSON.stringify({ mcpServers: upload.mcpServers }) })
  }
  const analyzed = analyzeAgentProfile(upload.harness, input)
  const hooks = [...analyzed.hooks]
  for (const hook of Array.isArray(upload.hooks) ? upload.hooks.slice(0, 100) : []) {
    if (hook && ['hook', 'notify', 'statusline'].includes(hook.kind) && typeof hook.command === 'string' && typeof hook.event === 'string') {
      hooks.push({ kind: hook.kind, event: hook.event.slice(0, 80), command: hook.command.slice(0, 500) })
    }
  }
  const secrets = new Map(analyzed.secrets.map((secret) => [secret.name, secret]))
  for (const secret of Array.isArray(upload.secrets) ? upload.secrets.slice(0, 200) : []) {
    if (secret && typeof secret.name === 'string' && SECRET_ENV_NAME.test(secret.name) && !secrets.has(secret.name)) {
      secrets.set(secret.name, { name: secret.name, usedBy: typeof secret.usedBy === 'string' ? secret.usedBy.slice(0, 80) : '' })
    }
  }
  return { ...analyzed, hooks, secrets: [...secrets.values()] }
}

/** The folders and files a client may read at the top of a harness's config folder; a browser uses it to skip big folders unread. */
export const AGENT_PROFILE_TOP_LEVEL: Record<AgentProfileHarness, readonly string[]> = {
  'claude-code': ['CLAUDE.md', 'settings.json', 'agents', 'commands', 'skills', 'output-styles'],
  codex: ['AGENTS.md', 'config.toml', 'prompts', 'skills'],
}
