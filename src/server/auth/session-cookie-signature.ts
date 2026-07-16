import 'server-only'

const textEncoder = new TextEncoder()

let signingKeysPromise: Promise<CryptoKey[]> | null = null
let signingKeysCacheKey = ''

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) {
    return null
  }

  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16)
  }
  return bytes
}

async function getSigningKeys(): Promise<CryptoKey[]> {
  const current = process.env.SESSION_SECRET?.trim()
  const previous = process.env.SESSION_SECRET_PREVIOUS?.trim()
  const secrets = [...new Set([current, previous].filter((secret): secret is string => Boolean(secret)))]
  const cacheKey = secrets.join('\0')
  if (!signingKeysPromise || signingKeysCacheKey !== cacheKey) {
    signingKeysCacheKey = cacheKey
    signingKeysPromise = Promise.all(
      secrets.map((secret) => crypto.subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )),
    )
  }
  return signingKeysPromise
}

export async function hasValidSessionCookieSignature(cookieValue: string | null | undefined): Promise<boolean> {
  const trimmed = cookieValue?.trim()
  if (!trimmed) return false

  const separatorIndex = trimmed.lastIndexOf('.')
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return false
  }

  const payload = trimmed.slice(0, separatorIndex)
  const providedSignature = trimmed.slice(separatorIndex + 1)
  const signatureBytes = hexToBytes(providedSignature)
  if (!signatureBytes) return false

  const keys = await getSigningKeys()
  for (const key of keys) {
    const expectedSignature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload))
    const expectedBytes = new Uint8Array(expectedSignature)
    if (expectedBytes.length !== signatureBytes.length) continue
    let diff = 0
    for (let index = 0; index < expectedBytes.length; index += 1) {
      diff |= expectedBytes[index]! ^ signatureBytes[index]!
    }
    if (diff === 0) return true
  }
  return false
}
