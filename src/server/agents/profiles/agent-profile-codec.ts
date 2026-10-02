import 'server-only'

import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { z } from 'zod'
import {
  AGENT_PROFILE_HARNESSES,
  analyzeAgentProfileUpload,
  bundleFromAnalysis,
  type AgentProfileBundle,
  type AgentProfileUpload,
} from '@layernorm/overlay-agent-bridge-protocol'

/** Convex documents are limited to 1 MiB; a chunk of base64 stays well under it. */
const CHUNK_CHARS = 800_000
/** What an upload may expand to; the compressed body is separately capped by the route. */
const MAX_UPLOAD_INFLATED_BYTES = 24 * 1024 * 1024
export const MAX_PROFILE_UPLOAD_BYTES = 4 * 1024 * 1024

export class AgentProfileError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'AgentProfileError'
  }
}

const uploadSchema = z.object({
  harness: z.enum(AGENT_PROFILE_HARNESSES),
  files: z.array(z.object({ path: z.string().max(400), content: z.string() })).max(6_000),
  mcpServers: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  hooks: z.array(z.object({ kind: z.enum(['hook', 'notify', 'statusline']), event: z.string(), command: z.string() })).max(200).optional(),
  secrets: z.array(z.object({ name: z.string(), usedBy: z.string() })).max(400).optional(),
}).strict()

/** Reads an upload body: gzip JSON, bounded both ways. */
export function readProfileUpload(body: Uint8Array): AgentProfileUpload {
  if (body.byteLength === 0 || body.byteLength > MAX_PROFILE_UPLOAD_BYTES) {
    throw new AgentProfileError('The import is empty or too large to upload. Remove big folders and try again.', 413, 'profile_upload_size')
  }
  let json: unknown
  try {
    json = JSON.parse(gunzipSync(body, { maxOutputLength: MAX_UPLOAD_INFLATED_BYTES }).toString('utf8'))
  } catch (_error) {
    throw new AgentProfileError('The import could not be read.', 400, 'profile_upload_unreadable')
  }
  const parsed = uploadSchema.safeParse(json)
  if (!parsed.success) throw new AgentProfileError('The import is not in the expected shape.', 400, 'profile_upload_invalid')
  return parsed.data as AgentProfileUpload
}

/** The cleaned bundle as storable chunks, and a digest of its contents. */
export function encodeProfileBundle(bundle: AgentProfileBundle): { chunks: string[]; digest: string } {
  const json = Buffer.from(JSON.stringify(bundle))
  const base64 = gzipSync(json, { level: 9 }).toString('base64')
  const chunks: string[] = []
  for (let offset = 0; offset < base64.length; offset += CHUNK_CHARS) chunks.push(base64.slice(offset, offset + CHUNK_CHARS))
  return { chunks, digest: createHash('sha256').update(json).digest('hex') }
}

/**
 * Reads a stored bundle back. The import rules run again on the way out, so a bundle that predates a stricter rule
 * (or was altered in storage) is cleaned before it can reach a machine.
 */
export function decodeProfileBundle(chunks: readonly string[]): AgentProfileBundle {
  let raw: AgentProfileBundle
  try {
    raw = JSON.parse(gunzipSync(Buffer.from(chunks.join(''), 'base64'), { maxOutputLength: MAX_UPLOAD_INFLATED_BYTES }).toString('utf8')) as AgentProfileBundle
  } catch (_error) {
    throw new AgentProfileError('This version could not be read.', 500, 'profile_unreadable')
  }
  return bundleFromAnalysis(analyzeAgentProfileUpload({
    harness: raw.harness, files: raw.files, mcpServers: raw.mcpServers, hooks: raw.hooks, secrets: raw.secrets,
  }))
}
