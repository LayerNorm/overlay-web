import 'server-only'

import { logger } from '@/server/observability/logger'
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ObjectStore, ObjectSummary } from '@overlay/app-core'
export { keyForFile, keyForOutput } from '@/server/storage/storage-keys'

export interface R2ObjectStoreConfig {
  accountId?: string
  bucketName?: string
  accessKeyId?: string
  secretAccessKey?: string
  endpointUrl?: string
  presignTtlSeconds?: number
}

function requireR2Env(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`[R2] Missing required env var: ${name}`)
  return value
}

function getR2Endpoint(): string {
  const configured = process.env['S3_API']?.trim()
  if (configured) {
    try {
      return new URL(configured).origin
    } catch (_error) {
      return configured
    }
  }
  return `https://${requireR2Env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`
}

export function getR2BucketName(): string {
  return requireR2Env('R2_BUCKET_NAME')
}

const MAX_PRESIGN_TTL_SECONDS = 900 // hard cap: 15 minutes
const DEFAULT_MAX_PRESIGNED_UPLOAD_BYTES = 100 * 1024 * 1024

function getR2PresignTtl(): number {
  const configured = parseInt(process.env['R2_PRESIGN_TTL_SECONDS'] ?? String(MAX_PRESIGN_TTL_SECONDS), 10)
  return Math.min(Number.isFinite(configured) && configured > 0 ? configured : 300, MAX_PRESIGN_TTL_SECONDS)
}

export function getR2PresignTtlSeconds(): number {
  return getR2PresignTtl()
}

export function getMaxPresignedUploadBytes(): number {
  const configured = parseInt(process.env['R2_MAX_PRESIGNED_UPLOAD_BYTES'] ?? '', 10)
  if (Number.isFinite(configured) && configured > 0) {
    return configured
  }
  return DEFAULT_MAX_PRESIGNED_UPLOAD_BYTES
}

export function createR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: getR2Endpoint(),
    credentials: {
      accessKeyId: requireR2Env('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireR2Env('R2_SECRET_ACCESS_KEY'),
    },
  })
}

let _client: S3Client | null = null
export function getR2Client(): S3Client {
  if (!_client) _client = createR2Client()
  return _client
}

function getConfiguredR2Endpoint(config: R2ObjectStoreConfig): string {
  if (config.endpointUrl) {
    try {
      return new URL(config.endpointUrl).origin
    } catch (_error) {
      return config.endpointUrl
    }
  }
  if (!config.accountId) {
    throw new Error('[R2] Missing required provider config: accountId')
  }
  return `https://${config.accountId}.r2.cloudflarestorage.com`
}

function createConfiguredR2Client(config: R2ObjectStoreConfig): S3Client {
  if (!config.accessKeyId) {
    throw new Error('[R2] Missing required provider config: accessKeyId')
  }
  if (!config.secretAccessKey) {
    throw new Error('[R2] Missing required provider config: secretAccessKey')
  }
  return new S3Client({
    region: 'auto',
    endpoint: getConfiguredR2Endpoint(config),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

// ── Presigned upload URL ─────────────────────────────────────────────────────

export async function generatePresignedUploadUrl(
  key: string,
  mimeType: string,
  sizeBytes: number,
  ttlSeconds?: number,
): Promise<string> {
  const client = getR2Client()
  const bucket = getR2BucketName()
  const ttl = ttlSeconds ?? getR2PresignTtl()
  const contentLength = Math.max(1, Math.round(sizeBytes))
  const t0 = Date.now()

  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mimeType,
      ContentLength: contentLength,
    }),
    { expiresIn: ttl },
  )

  logger.info(`[R2] generatePresignedUploadUrl key=${key} mimeType=${mimeType} size=${contentLength}B ttl=${ttl}s duration=${Date.now() - t0}ms`)
  return url
}

// ── Presigned download URL ───────────────────────────────────────────────────

export async function generatePresignedDownloadUrl(
  key: string,
  ttlSeconds?: number,
): Promise<string> {
  const client = getR2Client()
  const bucket = getR2BucketName()
  const ttl = ttlSeconds ?? getR2PresignTtl()
  const t0 = Date.now()

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttl },
  )

  logger.info(`[R2] generatePresignedDownloadUrl key=${key} ttl=${ttl}s duration=${Date.now() - t0}ms`)
  return url
}

// ── Server-side buffer upload ────────────────────────────────────────────────

export async function uploadBuffer(
  key: string,
  body: Buffer | Uint8Array | string,
  mimeType: string,
): Promise<void> {
  const client = getR2Client()
  const bucket = getR2BucketName()
  const sizeBytes = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
  const t0 = Date.now()

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
      ContentLength: sizeBytes,
    }),
  )

  logger.info(`[R2] uploadBuffer key=${key} mimeType=${mimeType} size=${sizeBytes}B duration=${Date.now() - t0}ms`)
}

// ── Server-side buffer download ────────────────────────────────────────────

export async function downloadBuffer(key: string): Promise<Buffer | null> {
  const client = getR2Client()
  const bucket = getR2BucketName()
  const t0 = Date.now()

  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!response.Body) return null
    const bytes = await response.Body.transformToByteArray()
    const buffer = Buffer.from(bytes)
    logger.info(`[R2] downloadBuffer key=${key} size=${buffer.byteLength}B duration=${Date.now() - t0}ms`)
    return buffer
  } catch (error) {
    logger.warn(`[R2] downloadBuffer key=${key} failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

// ── Delete single object ─────────────────────────────────────────────────────

export async function deleteObject(key: string): Promise<void> {
  const client = getR2Client()
  const bucket = getR2BucketName()
  const t0 = Date.now()

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))

  logger.info(`[R2] deleteObject key=${key} duration=${Date.now() - t0}ms`)
}

// ── Delete multiple objects (batch) ─────────────────────────────────────────

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return

  const client = getR2Client()
  const bucket = getR2BucketName()
  const t0 = Date.now()

  const BATCH_SIZE = 1000
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE)
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    )
    if (result.Errors && result.Errors.length > 0) {
      logger.error(`[R2] deleteObjects partial errors: ${JSON.stringify(result.Errors)}`)
    }
  }

  logger.info(`[R2] deleteObjects count=${keys.length} duration=${Date.now() - t0}ms`)
}

// ── Head object (check existence / metadata) ─────────────────────────────────

export async function headObject(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null> {
  const client = getR2Client()
  const bucket = getR2BucketName()

  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return {
      sizeBytes: res.ContentLength ?? 0,
      contentType: res.ContentType,
    }
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === 'NotFound' || code === 'NoSuchKey') return null
    throw err
  }
}

export class R2ObjectStore implements ObjectStore {
  private readonly configuredClient: S3Client | null
  private readonly configuredBucketName: string | null
  private readonly configuredPresignTtlSeconds: number | null
  readonly providerConfigSummary: {
    provider: 'r2'
    bucketName?: string
    endpointUrl?: string
    hasAccessKeyId: boolean
    hasSecretAccessKey: boolean
    presignTtlSeconds?: number
  }

  constructor(config: R2ObjectStoreConfig = {}) {
    const hasExplicitConfig = Object.values(config).some((value) => value !== undefined)
    this.configuredClient = hasExplicitConfig ? createConfiguredR2Client(config) : null
    this.configuredBucketName = config.bucketName ?? null
    this.configuredPresignTtlSeconds = config.presignTtlSeconds ?? null
    this.providerConfigSummary = {
      provider: 'r2',
      ...(config.bucketName ? { bucketName: config.bucketName } : {}),
      ...(config.endpointUrl ? { endpointUrl: config.endpointUrl } : {}),
      hasAccessKeyId: Boolean(config.accessKeyId),
      hasSecretAccessKey: Boolean(config.secretAccessKey),
      ...(config.presignTtlSeconds ? { presignTtlSeconds: config.presignTtlSeconds } : {}),
    }
  }

  async getUploadUrl(
    key: string,
    contentType: string,
  ): Promise<{ url: string; fields?: Record<string, string> }> {
    return {
      url: await getSignedUrl(
        this.client(),
        new PutObjectCommand({
          Bucket: this.bucketName(),
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn: this.presignTtlSeconds() },
      ),
    }
  }

  async getDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client(),
      new GetObjectCommand({ Bucket: this.bucketName(), Key: key }),
      { expiresIn: this.presignTtlSeconds() },
    )
  }

  async deleteObject(key: string): Promise<void> {
    await this.client().send(new DeleteObjectCommand({ Bucket: this.bucketName(), Key: key }))
  }

  async uploadBuffer(
    key: string,
    body: Buffer | Uint8Array | string,
    mimeType: string,
  ): Promise<void> {
    const sizeBytes = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
    await this.client().send(
      new PutObjectCommand({
        Bucket: this.bucketName(),
        Key: key,
        Body: body,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      }),
    )
  }

  async headObject(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null> {
    try {
      const res = await this.client().send(new HeadObjectCommand({ Bucket: this.bucketName(), Key: key }))
      return {
        sizeBytes: res.ContentLength ?? 0,
        contentType: res.ContentType,
      }
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name
      if (code === 'NotFound' || code === 'NoSuchKey') return null
      throw err
    }
  }

  async listObjects(prefix: string): Promise<ObjectSummary[]> {
    const out: ObjectSummary[] = []
    let ContinuationToken: string | undefined

    do {
      const page = await this.client().send(
        new ListObjectsV2Command({
          Bucket: this.bucketName(),
          Prefix: prefix,
          ContinuationToken,
        }),
      )

      for (const item of page.Contents ?? []) {
        if (!item.Key) continue
        out.push({
          key: item.Key,
          sizeBytes: item.Size,
          lastModified: item.LastModified?.toISOString(),
          etag: item.ETag,
        })
      }

      ContinuationToken = page.NextContinuationToken
    } while (ContinuationToken)

    return out
  }

  private client(): S3Client {
    return this.configuredClient ?? getR2Client()
  }

  private bucketName(): string {
    return this.configuredBucketName ?? getR2BucketName()
  }

  private presignTtlSeconds(): number {
    return this.configuredPresignTtlSeconds ?? getR2PresignTtl()
  }
}
