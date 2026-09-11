/**
 * smoke-r2-presign.ts
 *
 * Tests the full presigned URL flow:
 *   1. Generate a presigned PUT URL
 *   2. Upload via fetch() (simulates a browser direct upload)
 *   3. Generate a presigned GET URL
 *   4. Download via fetch() and verify content
 *   5. Delete the object
 *
 * Run: node --env-file=.env.local --experimental-strip-types scripts/smoke-r2-presign.ts
 */

import { S3Client, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function logStep(step: string) {
  console.log(`\n[R2-Presign] ▶ ${step}`)
}

function logOk(msg: string) {
  console.log(`[R2-Presign] ✓ ${msg}`)
}

function logErr(msg: string, err?: unknown) {
  console.error(`[R2-Presign] ✗ ${msg}`, err ?? '')
}

function resolveCorsOrigin(): string | null {
  return process.env['R2_CORS_ORIGIN']?.trim() ||
    process.env['NEXT_PUBLIC_APP_URL']?.trim() ||
    process.env['DEV_NEXT_PUBLIC_APP_URL']?.trim() ||
    null
}

async function main() {
  console.log('[R2-Presign] Starting R2 presigned URL smoke test...')

  const accountId = requireEnv('R2_ACCOUNT_ID')
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY')
  const bucketName = requireEnv('R2_BUCKET_NAME')
  const ttlSeconds = parseInt(process.env['R2_PRESIGN_TTL_SECONDS'] ?? '300', 10)
  const endpoint = process.env['S3_API']?.trim() || `https://${accountId}.r2.cloudflarestorage.com`
  const corsOrigin = resolveCorsOrigin()

  console.log(`[R2-Presign] Endpoint : ${endpoint}`)
  console.log(`[R2-Presign] Bucket   : ${bucketName}`)
  console.log(`[R2-Presign] TTL      : ${ttlSeconds}s`)
  if (corsOrigin) console.log(`[R2-Presign] Origin   : ${corsOrigin}`)

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  })

  const testKey = `smoke-test/presign-${Date.now()}.txt`
  const testPayload = `Presigned URL smoke test payload — ${new Date().toISOString()}`
  const testMimeType = 'text/plain'

  // ── 1. Generate presigned PUT URL ────────────────────────────────────────
  logStep('Generating presigned PUT URL')
  let putUrl: string
  const t0 = Date.now()
  try {
    putUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucketName,
        Key: testKey,
        ContentType: testMimeType,
      }),
      { expiresIn: ttlSeconds },
    )
    logOk(`Presigned PUT URL generated in ${Date.now() - t0}ms`)
    console.log(`[R2-Presign]   URL prefix: ${putUrl.slice(0, 80)}...`)
  } catch (err) {
    logErr('Failed to generate presigned PUT URL', err)
    process.exit(1)
  }

  // ── 2. Verify browser preflight for the presigned PUT URL ────────────────
  if (corsOrigin) {
    logStep('Checking browser CORS preflight for presigned PUT URL')
    try {
      const preflightRes = await fetch(putUrl, {
        method: 'OPTIONS',
        headers: {
          Origin: corsOrigin,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type',
        },
      })
      const allowOrigin = preflightRes.headers.get('access-control-allow-origin')
      const allowMethods = preflightRes.headers.get('access-control-allow-methods') ?? ''
      if (
        preflightRes.status !== 204 ||
        allowOrigin !== corsOrigin ||
        !allowMethods.split(',').map((method) => method.trim().toUpperCase()).includes('PUT')
      ) {
        logErr(
          `CORS preflight failed: HTTP ${preflightRes.status}; allow-origin=${allowOrigin}; allow-methods=${allowMethods}`,
        )
        process.exit(1)
      }
      logOk(`CORS preflight allows ${corsOrigin} to PUT`)
    } catch (err) {
      logErr('CORS preflight threw an error', err)
      process.exit(1)
    }
  } else {
    console.log('[R2-Presign] Skipping CORS preflight; set R2_CORS_ORIGIN to verify browser uploads.')
  }

  // ── 3. Upload via fetch() (simulates non-browser PUT) ────────────────────
  logStep('Uploading via fetch() to presigned PUT URL (browser simulation)')
  const t1 = Date.now()
  try {
    const uploadRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': testMimeType },
      body: testPayload,
    })
    if (!uploadRes.ok) {
      const errBody = await uploadRes.text()
      logErr(`fetch PUT failed: HTTP ${uploadRes.status} ${uploadRes.statusText}\n${errBody}`)
      process.exit(1)
    }
    logOk(`fetch PUT succeeded in ${Date.now() - t1}ms (HTTP ${uploadRes.status})`)
  } catch (err) {
    logErr('fetch PUT threw an error (possible CORS issue or network error)', err)
    process.exit(1)
  }

  // ── 4. Verify object exists via HeadObject ───────────────────────────────
  logStep('Verifying object exists via HeadObject')
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: testKey }))
    logOk(`Object exists — size: ${head.ContentLength} bytes, type: ${head.ContentType}`)
  } catch (err) {
    logErr('HeadObject failed — object may not have been written', err)
    process.exit(1)
  }

  // ── 5. Generate presigned GET URL ────────────────────────────────────────
  logStep('Generating presigned GET URL')
  let getUrl: string
  const t2 = Date.now()
  try {
    getUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucketName, Key: testKey }),
      { expiresIn: ttlSeconds },
    )
    logOk(`Presigned GET URL generated in ${Date.now() - t2}ms`)
    console.log(`[R2-Presign]   URL prefix: ${getUrl.slice(0, 80)}...`)
  } catch (err) {
    logErr('Failed to generate presigned GET URL', err)
    process.exit(1)
  }

  // ── 6. Download via fetch() and verify content ───────────────────────────
  logStep('Downloading via fetch() from presigned GET URL')
  const t3 = Date.now()
  try {
    const dlRes = await fetch(getUrl)
    if (!dlRes.ok) {
      logErr(`fetch GET failed: HTTP ${dlRes.status} ${dlRes.statusText}`)
      process.exit(1)
    }
    const body = await dlRes.text()
    if (body !== testPayload) {
      logErr(`Content mismatch!\n  expected: ${testPayload}\n  got:      ${body}`)
      process.exit(1)
    }
    logOk(`fetch GET succeeded in ${Date.now() - t3}ms — content verified (${body.length} chars)`)
  } catch (err) {
    logErr('fetch GET threw an error', err)
    process.exit(1)
  }

  // ── 7. Delete object ──────────────────────────────────────────────────────
  logStep(`Cleaning up: deleting ${testKey}`)
  const t4 = Date.now()
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: testKey }))
    logOk(`DELETE succeeded in ${Date.now() - t4}ms`)
  } catch (err) {
    logErr('DELETE failed — manual cleanup may be needed', err)
    process.exit(1)
  }

  console.log('\n[R2-Presign] ✅ All presigned URL checks passed — browser-direct upload flow works.\n')
}

main().catch((err) => {
  console.error('[R2-Presign] Fatal error:', err)
  process.exit(1)
})
