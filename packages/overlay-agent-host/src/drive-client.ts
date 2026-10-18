import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  driveCredentialsResponseSchema, driveManifestFrameSchema, drivePathSegments, portableDrivePathKey,
  driveUploadBodySchema, driveUploadResponseSchema, driveContentResultSchema, driveCommitBodySchema,
  driveMetadataBodySchema, driveMetadataResultSchema, driveReadyEntrySchema,
  type DriveCredentialsResponse, type DriveManifestEntry, type DriveReadyEntry,
  type DriveUploadRequest, type DriveUploadResponse, type DriveMetadataRequest,
  driveRecoveryRequestSchema, driveRecoveryResultSchema, type DriveRecoveryRequest,
} from '@layernorm/overlay-agent-bridge-protocol'

export class DriveRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(`Drive request failed: ${code} (${status})`) }
}
const pendingUpload = driveUploadResponseSchema.options[0]
type PendingUpload = z.infer<typeof pendingUpload>
const MAX_FILE = 16 * 1024 * 1024
const CHUNK = 1024 * 1024

/** One execution, one fixed drive. Credentials stay in memory and are renewed through device-signed transport. */
export class AgentDriveClient {
  private credential?: DriveCredentialsResponse
  private renewing?: Promise<DriveCredentialsResponse>
  private fixedScope?: string
  private refreshAt = 0
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => number
  private readonly url: URL

  constructor(private readonly options: {
    apiUrl: string
    credentials(): Promise<DriveCredentialsResponse>
    fetch?: typeof globalThis.fetch
    now?: () => number
  }) {
    this.url = safeUrl(options.apiUrl)
    if (this.url.pathname !== '/api/agent-drive' || this.url.search) throw Error('DRIVE_INVALID_ORIGIN')
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
  }

  async recover(input: DriveRecoveryRequest) {
    const request = validated(driveRecoveryRequestSchema, input)
    const result = validated(driveRecoveryResultSchema, await json(await this.request(request)))
    if (result.requestId !== request.requestId || result.previousExecution.attemptId !== request.previousExecution.attemptId
      || result.previousExecution.generation !== request.previousExecution.generation
      || (result.resolution.state === 'content_committed' && request.kind !== 'content')
      || (result.resolution.state === 'metadata_committed' && request.kind !== 'metadata')) throw Error('DRIVE_RECOVERY_UNAVAILABLE')
    return result
  }

  private async token(): Promise<DriveCredentialsResponse> {
    if (this.credential && this.now() < this.refreshAt) return this.credential
    if (!this.renewing) this.renewing = (async () => {
      const credential = validated(driveCredentialsResponseSchema, await this.options.credentials())
      if (credential.expiresAt <= this.now()) throw Error('DRIVE_CREDENTIAL_EXPIRED')
      const scope = JSON.stringify(credential.scope)
      if (this.fixedScope && scope !== this.fixedScope) throw Error('DRIVE_SCOPE_CHANGED')
      this.fixedScope = scope
      this.credential = credential
      const remaining = credential.expiresAt - this.now()
      this.refreshAt = this.now() + Math.max(remaining - 60_000, remaining / 2)
      return credential
    })()
    try { return await this.renewing } finally { this.renewing = undefined }
  }

  /** Retry only an explicitly unauthorized request, once. Ambiguous writes keep their caller's journal identity. */
  private async request(body: unknown): Promise<Response> {
    const serialized = JSON.stringify(body)
    if (Buffer.byteLength(serialized) > 32 * 1024) throw Error('DRIVE_REQUEST_TOO_LARGE')
    for (let attempt = 0; attempt < 2; attempt++) {
      const credential = await this.token()
      const response = await this.fetch(this.url, { method: 'POST', body: serialized,
        headers: { authorization: `Bearer ${credential.token}`, 'content-type': 'application/json' },
        redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30_000) })
      if (response.ok) return response
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel()
        if (this.credential === credential) this.credential = undefined
        continue
      }
      let code = 'DRIVE_HTTP_FAILED'
      try {
        const value: unknown = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 32768)))
        const parsed = z.object({ error: z.string().regex(/^DRIVE_[A-Z_]+$/) }).safeParse(value)
        if (parsed.success) code = parsed.data.error
      } catch (_error) { /* Never include response text, URL or credentials in an error. */ }
      throw new DriveRequestError(response.status, code)
    }
    throw Error('DRIVE_UNAUTHORIZED')
  }

  async manifest(): Promise<DriveManifestEntry[]> {
    const response = await this.request({ action: 'manifest' })
    if (!response.body) throw Error('DRIVE_MANIFEST_UNAVAILABLE')
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const entries: DriveManifestEntry[] = []
    const paths = new Set<string>(), ids = new Set<string>()
    let buffered = '', bytes = 0, started = false, complete = false
    const append = (line: string) => {
      if (!line) return
      if (line.length > 16384) throw Error('DRIVE_MANIFEST_LIMIT')
      const frame = validated(driveManifestFrameSchema, parseJson(line))
      if (complete) throw Error('DRIVE_MANIFEST_FRAME')
      if (frame.type === 'manifest') { if (started) throw Error('DRIVE_MANIFEST_FRAME'); started = true; return }
      if (!started) throw Error('DRIVE_MANIFEST_FRAME')
      if (frame.type === 'complete') {
        if (frame.entries !== entries.length) throw Error('DRIVE_MANIFEST_INCOMPLETE')
        complete = true; return
      }
      if (entries.length >= 10000) throw Error('DRIVE_MANIFEST_LIMIT')
      const entry = frame.entry
      drivePathSegments(entry.path)
      const path = portableDrivePathKey(entry.path)
      if (paths.has(path) || ids.has(entry.fileId)) throw Error('DRIVE_AMBIGUOUS_PATH')
      paths.add(path); ids.add(entry.fileId); entries.push(entry)
    }
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > 32 * 1024 * 1024) throw Error('DRIVE_MANIFEST_LIMIT')
        buffered += decoder.decode(chunk.value, { stream: true })
        let newline: number
        while ((newline = buffered.indexOf('\n')) >= 0) { append(buffered.slice(0, newline)); buffered = buffered.slice(newline + 1) }
        if (buffered.length > 16384) throw Error('DRIVE_MANIFEST_LIMIT')
      }
      append(buffered + decoder.decode())
      if (!complete) throw Error('DRIVE_MANIFEST_INCOMPLETE')
      return entries
    } finally { await reader.cancel().catch((_error) => undefined); reader.releaseLock() }
  }

  async download(input: DriveReadyEntry): Promise<Uint8Array> {
    const entry = validated(driveReadyEntrySchema, input)
    const identity = { fileId: entry.fileId, path: entry.path, updatedAt: entry.updatedAt, kind: entry.kind,
      hydration: entry.hydration, sizeBytes: entry.sizeBytes, sha256: entry.sha256 }
    if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || entry.sizeBytes > MAX_FILE) throw Error('DRIVE_FILE_TOO_LARGE')
    drivePathSegments(entry.path)
    const bytes = new Uint8Array(entry.sizeBytes)
    let offset = 0
    do {
      const expected = Math.min(CHUNK, bytes.length - offset)
      const response = await this.request({ action: 'download', entry: identity, downloadMac: entry.downloadMac, offset, length: CHUNK })
      if (response.status !== (bytes.length ? 206 : 200) || response.headers.get('x-overlay-drive-size') !== String(bytes.length)
        || (bytes.length > 0 && response.headers.get('content-range') !== `bytes ${offset}-${offset + expected - 1}/${bytes.length}`)) {
        await response.body?.cancel()
        throw Error('DRIVE_RANGE_CHANGED')
      }
      const chunk = await boundedBytes(response, expected)
      if (chunk.byteLength !== expected) throw Error('DRIVE_RANGE_CHANGED')
      bytes.set(chunk, offset)
      offset += chunk.length
    } while (offset < bytes.length)
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error('DRIVE_HASH_MISMATCH')
    return bytes
  }

  async intent(input: DriveUploadRequest): Promise<DriveUploadResponse> {
    return validated(driveUploadResponseSchema, await json(await this.request(driveUploadBodySchema.parse(input))))
  }

  async upload(upload: PendingUpload, bytes: Uint8Array, sha256: string): Promise<void> {
    const intent = validated(pendingUpload, upload)
    if (bytes.byteLength !== intent.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== sha256
      || Buffer.from(sha256, 'hex').toString('base64') !== intent.headers['x-amz-checksum-sha256']) throw Error('DRIVE_UPLOAD_CHANGED')
    const response = await this.fetch(safeUrl(intent.url), { method: 'PUT', body: Uint8Array.from(bytes).buffer,
      headers: intent.headers, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30_000) })
    await response.body?.cancel()
    if (!response.ok) throw new DriveRequestError(response.status, 'DRIVE_UPLOAD_FAILED')
  }

  async commit(uploadId: string) {
    return validated(driveContentResultSchema, await json(await this.request(driveCommitBodySchema.parse({ action: 'commit', uploadId }))))
  }

  async metadata(input: DriveMetadataRequest) {
    return validated(driveMetadataResultSchema, await json(await this.request(driveMetadataBodySchema.parse(input))))
  }
}

function safeUrl(value: string): URL {
  const url = new URL(value)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) throw Error('DRIVE_INVALID_ORIGIN')
  return url
}

async function json(response: Response): Promise<unknown> {
  return parseJson(new TextDecoder('utf-8', { fatal: true }).decode(await boundedBytes(response, 32768)))
}

async function boundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > maximum)) {
    await response.body?.cancel()
    throw Error('DRIVE_RESPONSE_LIMIT')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maximum) throw Error('DRIVE_RESPONSE_LIMIT')
      chunks.push(next.value)
    }
  } finally { await reader.cancel().catch((_error) => undefined); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw Error('DRIVE_INVALID_RESPONSE')
  return result.data
}

function parseJson(input: string): unknown {
  try { return JSON.parse(input) }
  catch (_error) { throw Error('DRIVE_INVALID_RESPONSE') }
}
