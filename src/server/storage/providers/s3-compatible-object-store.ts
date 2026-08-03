import 'server-only'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ObjectStore, ObjectSummary } from '@overlay/app-core'

export interface S3CompatibleObjectStoreConfig {
  provider?: 's3'
  bucketName: string
  region: string
  endpointUrl?: string
  accessKeyId?: string
  secretAccessKey?: string
  forcePathStyle?: boolean
  presignTtlSeconds?: number
}

export class S3CompatibleObjectStore implements ObjectStore {
  private readonly client: S3Client
  private readonly bucketName: string
  private readonly presignTtlSeconds: number
  readonly providerConfigSummary: {
    provider: 's3'
    bucketName: string
    region: string
    endpointUrl?: string
    forcePathStyle?: boolean
    hasAccessKeyId: boolean
    hasSecretAccessKey: boolean
  }

  constructor(config: S3CompatibleObjectStoreConfig) {
    this.bucketName = config.bucketName
    this.presignTtlSeconds = Math.min(
      Math.max(1, config.presignTtlSeconds ?? 900),
      900,
    )
    const credentials = config.accessKeyId && config.secretAccessKey
      ? {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        }
      : undefined
    this.client = new S3Client({
      region: config.region,
      ...(config.endpointUrl ? { endpoint: config.endpointUrl } : {}),
      forcePathStyle: config.forcePathStyle,
      ...(credentials ? { credentials } : {}),
    })
    this.providerConfigSummary = {
      provider: config.provider ?? 's3',
      bucketName: config.bucketName,
      region: config.region,
      ...(config.endpointUrl ? { endpointUrl: config.endpointUrl } : {}),
      ...(config.forcePathStyle !== undefined ? { forcePathStyle: config.forcePathStyle } : {}),
      hasAccessKeyId: Boolean(config.accessKeyId),
      hasSecretAccessKey: Boolean(config.secretAccessKey),
    }
  }

  async getUploadUrl(
    key: string,
    contentType: string,
  ): Promise<{ url: string; fields?: Record<string, string> }> {
    return {
      url: await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn: this.presignTtlSeconds },
      ),
    }
  }

  async getDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
      { expiresIn: this.presignTtlSeconds },
    )
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }))
  }

  async uploadBuffer(
    key: string,
    body: Buffer | Uint8Array | string,
    mimeType: string,
  ): Promise<void> {
    const sizeBytes = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      }),
    )
  }

  async headObject(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }))
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
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
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
}
