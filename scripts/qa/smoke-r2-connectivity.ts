/**
 * smoke-r2-connectivity.ts
 * 
 * Tests basic R2 S3 connectivity: put, get, delete.
 * Run: node --env-file=.env.local --experimental-strip-types scripts/smoke-r2-connectivity.ts
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function logStep(step: string) {
  console.log(`\n[R2-Connectivity] ▶ ${step}`)
}

function logOk(msg: string) {
  console.log(`[R2-Connectivity] ✓ ${msg}`)
}

function logErr(msg: string, err?: unknown) {
  console.error(`[R2-Connectivity] ✗ ${msg}`, err ?? '')
}

async function streamToString(stream: ReadableStream | NodeJS.ReadableStream): Promise<string> {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

async function main() {
  console.log('[R2-Connectivity] Starting R2 connectivity smoke test...')

  const accountId = requireEnv('R2_ACCOUNT_ID')
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY')
  const bucketName = requireEnv('R2_BUCKET_NAME')
  const endpoint = process.env['S3_API']?.trim() || `https://${accountId}.r2.cloudflarestorage.com`

  console.log(`[R2-Connectivity] Endpoint  : ${endpoint}`)
  console.log(`[R2-Connectivity] Bucket    : ${bucketName}`)
  console.log(`[R2-Connectivity] AccessKey : ${accessKeyId.slice(0, 8)}...`)

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  })

  const testKey = `smoke-test/connectivity-${Date.now()}.txt`
  const testContent = `R2 connectivity smoke test — ${new Date().toISOString()}`

  // ── 1. Verify bucket exists ──────────────────────────────────────────────
  logStep('Checking bucket exists via HeadBucket')
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }))
    logOk(`Bucket "${bucketName}" is accessible`)
  } catch (err) {
    logErr(`Cannot access bucket "${bucketName}" — check credentials and bucket name`, err)
    process.exit(1)
  }

  // ── 2. Put object ────────────────────────────────────────────────────────
  logStep(`Uploading object: ${testKey}`)
  const t0 = Date.now()
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: testKey,
        Body: testContent,
        ContentType: 'text/plain',
      }),
    )
    logOk(`PUT succeeded in ${Date.now() - t0}ms (${Buffer.byteLength(testContent)} bytes)`)
  } catch (err) {
    logErr('PUT failed', err)
    process.exit(1)
  }

  // ── 3. Get object and verify content ─────────────────────────────────────
  logStep(`Downloading object: ${testKey}`)
  const t1 = Date.now()
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucketName, Key: testKey }),
    )
    if (!res.Body) {
      logErr('GET returned no body')
      process.exit(1)
    }
    const body = await streamToString(res.Body as NodeJS.ReadableStream)
    if (body !== testContent) {
      logErr(`Content mismatch!\n  expected: ${testContent}\n  got:      ${body}`)
      process.exit(1)
    }
    logOk(`GET succeeded in ${Date.now() - t1}ms — content verified (${body.length} chars)`)
  } catch (err) {
    logErr('GET failed', err)
    process.exit(1)
  }

  // ── 4. Delete object ──────────────────────────────────────────────────────
  logStep(`Deleting object: ${testKey}`)
  const t2 = Date.now()
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: testKey }))
    logOk(`DELETE succeeded in ${Date.now() - t2}ms`)
  } catch (err) {
    logErr('DELETE failed', err)
    process.exit(1)
  }

  // ── 5. Verify deletion (GetObject should 404) ─────────────────────────────
  logStep('Verifying deletion (expect 404/NoSuchKey)')
  try {
    await client.send(new GetObjectCommand({ Bucket: bucketName, Key: testKey }))
    logErr('Object still exists after DELETE — unexpected!')
    process.exit(1)
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name
    if (code === 'NoSuchKey' || code === 'NotFound') {
      logOk(`Object correctly absent after DELETE (${code})`)
    } else {
      logErr(`Unexpected error during post-delete GET`, err)
      process.exit(1)
    }
  }

  console.log('\n[R2-Connectivity] ✅ All checks passed — R2 connectivity is working correctly.\n')
}

main().catch((err) => {
  console.error('[R2-Connectivity] Fatal error:', err)
  process.exit(1)
})
