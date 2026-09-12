/**
 * Smoke test: JWT verification pipeline
 *
 * Phase 1 (always runs): Fetch JWKS for the configured WorkOS client(s) and
 *   confirm they return RSA keys.
 *
 * Phase 2 (runs when WORKOS_ACCESS_TOKEN is set): Decode the JWT, check every
 *   claim gate, find the matching JWK, and verify the signature — printing the
 *   same diagnostics that debugAccessTokenVerification emits on the server.
 *
 * Usage:
 *   # Phase 1 only (no token needed)
 *   npx tsx scripts/smoke-jwt.ts
 *
 *   # Phase 1 + Phase 2 (paste the FULL_TOKEN from the desktop debug log)
 *   WORKOS_ACCESS_TOKEN="eyJ..." npx tsx scripts/smoke-jwt.ts
 *
 * Env vars read (in priority order):
 *   WORKOS_CLIENT_ID, DEV_WORKOS_CLIENT_ID   — client IDs to test
 *   WORKOS_API_KEY,   DEV_WORKOS_API_KEY     — used when fetching JWKS (mirrors server)
 *
 * You can point at overlay's .env.local with:
 *   env $(grep -v '^#' ../overlay-desktop/.env.local | xargs) npx tsx scripts/smoke-jwt.ts
 */

// env vars are loaded by --env-file=../overlay-desktop/.env.local in the npm script

// ─── helpers ────────────────────────────────────────────────────────────────

function pad(s: string): string {
  const r = s.replace(/-/g, '+').replace(/_/g, '/')
  return r + '='.repeat((4 - (r.length % 4)) % 4)
}

function b64decode(s: string): string {
  return Buffer.from(pad(s), 'base64').toString('utf-8')
}

function b64toUint8(s: string): Uint8Array {
  const bin = Buffer.from(pad(s), 'base64')
  return new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength)
}

function ok(msg: string) { console.log('  ✅', msg) }
function fail(msg: string) { console.error('  ❌', msg) }
function info(msg: string) { console.log('  ℹ️ ', msg) }

// ─── Phase 1: JWKS fetch ─────────────────────────────────────────────────────

async function fetchJwks(clientId: string, apiKey?: string) {
  const url = `https://api.workos.com/sso/jwks/${clientId}`
  info(`GET ${url}`)
  const headers: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {}
  const res = await fetch(url, { headers })
  info(`HTTP ${res.status}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`JWKS fetch failed (${res.status}): ${body}`)
  }
  const json = await res.json() as { keys?: unknown[] }
  return Array.isArray(json.keys) ? json.keys as Array<Record<string, unknown>> : []
}

async function phase1() {
  console.log('\n=== Phase 1: JWKS Fetch ===')

  const clientIds = [
    process.env.WORKOS_CLIENT_ID,
    process.env.DEV_WORKOS_CLIENT_ID,
  ].filter((v): v is string => Boolean(v?.trim()))

  const apiKey = process.env.WORKOS_API_KEY || process.env.DEV_WORKOS_API_KEY

  if (clientIds.length === 0) {
    fail('No WORKOS_CLIENT_ID or DEV_WORKOS_CLIENT_ID in env — cannot fetch JWKS')
    process.exit(1)
  }

  info(`Configured client IDs: ${JSON.stringify(clientIds)}`)
  info(`API key present: ${apiKey ? 'yes (' + apiKey.slice(0, 8) + '...)' : 'no'}`)

  const jwksByClient: Record<string, Array<Record<string, unknown>>> = {}

  for (const clientId of clientIds) {
    console.log(`\n  Client: ${clientId}`)
    try {
      const keys = await fetchJwks(clientId, apiKey)
      if (keys.length === 0) {
        fail(`JWKS returned 0 keys`)
      } else {
        ok(`JWKS returned ${keys.length} key(s)`)
        for (const k of keys) {
          info(`  kid=${k.kid ?? '(none)'}  kty=${k.kty ?? '?'}  alg=${k.alg ?? '?'}`)
        }
      }
      jwksByClient[clientId] = keys
    } catch (err) {
      fail(String(err))
    }
  }

  return jwksByClient
}

// ─── Phase 2: full JWT verification ─────────────────────────────────────────

async function phase2(token: string, jwksByClient: Record<string, Array<Record<string, unknown>>>) {
  console.log('\n=== Phase 2: JWT Verification ===')

  const parts = token.trim().split('.')
  if (parts.length !== 3) { fail('Token is not a 3-part JWT'); return }

  const [headerSeg, payloadSeg, sigSeg] = parts

  let header: Record<string, unknown>
  let claims: Record<string, unknown>
  try {
    header  = JSON.parse(b64decode(headerSeg))
    claims  = JSON.parse(b64decode(payloadSeg))
  } catch (e) {
    fail('Could not decode JWT segments: ' + e); return
  }

  const aud = claims.aud as string | string[] | undefined
  const audArr = Array.isArray(aud) ? aud : aud ? [aud] : []
  const iss = claims.iss as string | undefined
  const sub = claims.sub as string | undefined
  const exp = claims.exp as number | undefined
  const kid = header.kid as string | undefined
  const alg = header.alg as string | undefined

  info(`iss : ${iss ?? '(missing)'}`)
  info(`aud : ${JSON.stringify(audArr)}`)
  info(`sub : ${sub ? sub.slice(0, 12) + '...' : '(missing)'}`)
  info(`exp : ${exp ? new Date(exp * 1000).toISOString() : '(missing)'} (${exp && exp * 1000 > Date.now() ? 'valid' : '⚠ EXPIRED'})`)
  info(`alg : ${alg ?? '(missing)'}`)
  info(`kid : ${kid ?? '(missing)'}`)

  // Extract client ID from iss claim (https://api.workos.com/user_management/{clientId})
  const issClientId = iss?.match(/\/user_management\/(client_\S+)/)?.[1] ?? null
  if (issClientId) {
    info(`Client ID from iss: ${issClientId}`)
  }

  // Build the full list of client IDs to try: configured + iss-derived
  const allClientIds = [...new Set([...Object.keys(jwksByClient), ...(issClientId ? [issClientId] : [])])]
  info(`All candidate client IDs: ${JSON.stringify(allClientIds)}`)

  // Fetch JWKS for any new client IDs discovered from iss
  const apiKey = process.env.WORKOS_API_KEY || process.env.DEV_WORKOS_API_KEY
  for (const id of allClientIds) {
    if (!jwksByClient[id]) {
      info(`Fetching JWKS for iss-derived client: ${id}`)
      try {
        const keys = await fetchJwks(id, apiKey)
        jwksByClient[id] = keys
        ok(`JWKS for ${id}: ${keys.length} key(s) — kids: ${keys.map(k => k.kid).join(', ')}`)
      } catch (e) {
        fail(`JWKS fetch for ${id} failed: ${e}`)
        jwksByClient[id] = []
      }
    }
  }

  // Issuer check
  const TRUSTED = new Set([
    'https://api.workos.com',
    ...allClientIds.map(id => `https://api.workos.com/user_management/${id}`),
  ])
  const normalizedIss = iss?.trim().replace(/\/+$/, '') ?? ''
  if (!TRUSTED.has(normalizedIss)) {
    fail(`Issuer "${iss}" not trusted. Trusted: ${[...TRUSTED].join(', ')}`)
    return
  }
  ok(`Issuer trusted`)

  // Audience / client selection
  if (audArr.length === 0) {
    info('Token has no aud claim — will try all candidate client IDs for JWKS')
  } else {
    const matchingConfigured = Object.keys(jwksByClient).find(id => audArr.includes(id))
    if (!matchingConfigured) {
      fail(`Audience mismatch — token aud=${JSON.stringify(audArr)} but configured IDs=${JSON.stringify(Object.keys(jwksByClient))}`)
      info('→ Add the token\'s aud value as WORKOS_CLIENT_ID or DEV_WORKOS_CLIENT_ID in Vercel env vars')
      return
    }
    ok(`Audience matched client: ${matchingConfigured}`)
  }

  // kid lookup — try all candidate clients
  if (!kid) { fail('No kid in token header'); return }
  let jwk: Record<string, unknown> | undefined
  let jwkClientId: string | undefined
  for (const id of allClientIds) {
    const match = (jwksByClient[id] ?? []).find(k => k.kid === kid)
    if (match) { jwk = match; jwkClientId = id; break }
  }
  if (!jwk) {
    fail(`kid "${kid}" not found in any JWKS. Available kids per client:`)
    for (const [id, keys] of Object.entries(jwksByClient)) {
      info(`  ${id}: ${keys.map(k => k.kid).join(', ') || '(none)'}`)
    }
    return
  }
  ok(`JWK found for kid=${kid} in client ${jwkClientId}`)

  // Signature verification
  const signingInput = `${headerSeg}.${payloadSeg}`
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const sigBytes = b64toUint8(sigSeg)
    const inputBytes = new TextEncoder().encode(signingInput)
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigBytes, inputBytes)
    if (valid) {
      ok('Signature verified ✓  — token would be ACCEPTED by the server')
    } else {
      fail('Signature invalid — token would be REJECTED')
    }
  } catch (err) {
    fail('Signature verification threw: ' + err)
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('WorkOS JWT smoke test')
  console.log('NODE_ENV=' + (process.env.NODE_ENV ?? '(unset)'))

  const jwksByClient = await phase1()

  let token = process.env.WORKOS_ACCESS_TOKEN?.trim()
  if (!token) {
    try {
      token = (await import('fs')).readFileSync('/tmp/overlay_token.txt', 'utf-8').trim()
      console.log('\n(Using token from /tmp/overlay_token.txt)')
    } catch { /* file not found */ }
  }
  if (token) {
    await phase2(token, jwksByClient)
  } else {
    console.log('\n(No token found — set WORKOS_ACCESS_TOKEN=<jwt> or let the desktop write to /tmp/overlay_token.txt)')
    console.log('Restart npm run dev in the overlay directory, then immediately re-run this test.')
  }

  console.log('\nDone.')
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1) })
