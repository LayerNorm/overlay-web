import { z } from 'zod/v3'

/**
 * Local tools: request/response tool calls Overlay sends to a host so the
 * native Overlay harness can act on the machine the host runs on. This channel
 * is independent of runs, adapters and ACP; a host with zero adapters can serve it.
 */
export const LOCAL_TOOLS_VERSION = 1 as const
export const MAX_LOCAL_TOOL_CALLS_PER_POLL = 10
/** Results are stored in Convex documents; keep them well below the 1 MiB document limit. */
export const MAX_LOCAL_TOOL_RESULT_BYTES = 768 * 1024
export const MAX_LOCAL_TOOL_REQUEST_BYTES = 640 * 1024
export const LOCAL_TOOL_POLL_WAIT_MAX_MS = 20_000

export const LOCAL_TOOL_FEATURES = ['exec', 'files', 'terminal', 'screenshot', 'input', 'browser'] as const
export type LocalToolFeature = (typeof LOCAL_TOOL_FEATURES)[number]

export const localToolsCapabilitySchema = z.object({
  version: z.literal(LOCAL_TOOLS_VERSION),
  os: z.enum(['darwin', 'linux', 'win32']),
  features: z.array(z.enum(LOCAL_TOOL_FEATURES)).max(LOCAL_TOOL_FEATURES.length),
  /** Real home directory, so the model can resolve `~` and default listings. */
  homeDirectory: z.string().trim().min(1).max(4096),
}).strict()
export type LocalToolsCapability = z.infer<typeof localToolsCapabilitySchema>

const localPath = z.string().trim().min(1).max(4096).refine((value) => !value.includes('\0'), 'path must not contain NUL')

/** The driver commands mirror the cloud Computer driver so the same tools work on both targets. */
export const LOCAL_DRIVER_COMMANDS = [
  'capabilities', 'screenshot', 'wait', 'click', 'move', 'drag', 'type', 'key', 'scroll',
  'browser_ensure', 'browser', 'open_url',
  'terminal_start', 'terminal_read', 'terminal_cancel', 'terminal_list',
] as const
export type LocalDriverCommand = (typeof LOCAL_DRIVER_COMMANDS)[number]

export const localToolRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('exec'),
    command: z.string().min(1).max(100_000),
    cwd: localPath.optional(),
    timeoutMs: z.number().int().min(1_000).max(300_000),
  }).strict(),
  z.object({ kind: z.literal('read_file'), path: localPath, maxBytes: z.number().int().positive().max(512 * 1024) }).strict(),
  z.object({ kind: z.literal('write_file'), path: localPath, contentsBase64: z.string().max(MAX_LOCAL_TOOL_REQUEST_BYTES) }).strict(),
  z.object({ kind: z.literal('list_files'), path: localPath }).strict(),
  z.object({
    kind: z.literal('driver'),
    command: z.enum(LOCAL_DRIVER_COMMANDS),
    args: z.record(z.string(), z.unknown()),
  }).strict(),
])
export type LocalToolRequest = z.infer<typeof localToolRequestSchema>

const identifier = z.string().trim().min(1).max(200)

export const localToolCallSchema = z.object({
  protocolVersion: z.literal(1),
  callId: identifier,
  environmentId: identifier,
  workspaceId: identifier,
  issuedAt: z.number().int().positive(),
  /** The server stops waiting at this time; a host must not start a call after it. */
  deadlineAt: z.number().int().positive(),
  request: localToolRequestSchema,
}).strict()
export type LocalToolCall = z.infer<typeof localToolCallSchema>

export const localToolPollResponseSchema = z.object({
  protocolVersion: z.literal(1),
  calls: z.array(localToolCallSchema).max(MAX_LOCAL_TOOL_CALLS_PER_POLL),
}).strict()
export type LocalToolPollResponse = z.infer<typeof localToolPollResponseSchema>

export const localToolErrorSchema = z.object({
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(2_000),
  missing: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
}).strict()
export type LocalToolError = z.infer<typeof localToolErrorSchema>

export const localToolResultSchema = z.object({
  protocolVersion: z.literal(1),
  callId: identifier,
  outcome: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), result: z.record(z.string(), z.unknown()) }).strict(),
    z.object({ ok: z.literal(false), error: localToolErrorSchema }).strict(),
  ]),
}).strict()
export type LocalToolResult = z.infer<typeof localToolResultSchema>
export type LocalToolOutcome = LocalToolResult['outcome']

/** Exec result shape returned by hosts. */
export type LocalExecResult = { stdout: string; stderr: string; exitCode: number; startedAt: number; endedAt: number; truncated: boolean }
/** read_file result shape returned by hosts. */
export type LocalReadFileResult = { found: false } | { found: true; contentsBase64: string; bytes: number; truncated: boolean }
/** list_files result shape returned by hosts. */
export type LocalListFilesResult = { entries: Array<{ path: string; kind: 'file' | 'directory' | 'symlink' | 'other'; size?: number }> }
