const MIN_SECRET_LENGTH = 32
const ROTATING_SECRETS = [
  ['SESSION_SECRET', 'SESSION_SECRET_PREVIOUS'],
  ['SESSION_COOKIE_ENCRYPTION_KEY', 'SESSION_COOKIE_ENCRYPTION_KEY_PREVIOUS'],
  ['SESSION_TRANSFER_KEY', 'SESSION_TRANSFER_KEY_PREVIOUS'],
] as const

const rotationPhase = valueArg('phase') ?? 'steady'
if (!['steady', 'overlap', 'finalize'].includes(rotationPhase)) {
  throw new Error('P5 security phase must be steady, overlap, or finalize')
}

const databaseUrl = required('OVERLAY_DATABASE_URL')
const database = new URL(databaseUrl)
if (!['postgres:', 'postgresql:'].includes(database.protocol)) {
  throw new Error('OVERLAY_DATABASE_URL must use postgres:// or postgresql://')
}
if (process.env.OVERLAY_DATABASE_SSL_MODE !== 'verify-full') {
  throw new Error('OVERLAY_DATABASE_SSL_MODE=verify-full is required for P5 security readiness')
}
if (isLocalHost(database.hostname) && process.env.P5_ALLOW_LOCAL_DATABASE !== 'true') {
  throw new Error('P5 security readiness requires a non-local database unless P5_ALLOW_LOCAL_DATABASE=true')
}

const requiredSecrets = [
  'SESSION_SECRET',
  'SESSION_COOKIE_ENCRYPTION_KEY',
  'SESSION_TRANSFER_KEY',
  'INTERNAL_API_SECRET',
  'INTERNAL_SERVICE_AUTH_SECRET',
]
const authProvider = (process.env.AUTH_PROVIDER ?? process.env.OVERLAY_PROVIDER_AUTH ?? '').trim()
if (authProvider === 'better-auth') requiredSecrets.push('BETTER_AUTH_SECRET')
const secrets = new Map(requiredSecrets.map((name) => [name, strongSecret(name)]))
assertDistinct(secrets)

for (const [currentName, previousName] of ROTATING_SECRETS) {
  const previous = process.env[previousName]?.trim()
  if (rotationPhase === 'overlap' && !previous) {
    throw new Error(`${previousName} is required during rotation overlap`)
  }
  if (rotationPhase === 'finalize' && previous) {
    throw new Error(`${previousName} must be removed during rotation finalization`)
  }
  if (previous) {
    if (previous.length < MIN_SECRET_LENGTH)
      throw new Error(`${previousName} must be at least ${MIN_SECRET_LENGTH} characters`)
    if (previous === secrets.get(currentName)) throw new Error(`${previousName} must differ from ${currentName}`)
  }
}

const publicValues = Object.entries(process.env).filter(
  ([name, value]) => name.startsWith('NEXT_PUBLIC_') && Boolean(value),
)
for (const [secretName, secret] of secrets) {
  const leakedAs = publicValues.find(([, value]) => value === secret)?.[0]
  if (leakedAs) throw new Error(`${secretName} must not be exposed as ${leakedAs}`)
}

const presignTtl = numberValue(process.env.S3_PRESIGN_TTL_SECONDS, 900)
if (presignTtl < 1 || presignTtl > 900) {
  throw new Error('S3_PRESIGN_TTL_SECONDS must be between 1 and 900')
}

const convexEnv = ['NEXT_PUBLIC_CONVEX_URL', 'DEV_NEXT_PUBLIC_CONVEX_URL', 'CONVEX_DEPLOYMENT'].filter((name) =>
  Boolean(process.env[name]?.trim()),
)
if (process.env.P5_REQUIRE_NO_CONVEX_ENV === 'true' && convexEnv.length > 0) {
  throw new Error(`Postgres deployment still exposes Convex environment variables: ${convexEnv.join(', ')}`)
}

console.log(
  JSON.stringify(
    {
      ok: true,
      databaseHost: database.hostname,
      databaseTls: 'verify-full',
      rotationPhase,
      rotatingKeyOverlap: ROTATING_SECRETS.filter(([, previous]) => Boolean(process.env[previous]?.trim())).length,
      requiredSecretCount: secrets.size,
      s3PresignTtlSeconds: presignTtl,
      convexEnvironmentVariablesPresent: convexEnv.length,
    },
    null,
    2,
  ),
)

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function strongSecret(name: string): string {
  const value = required(name)
  if (value.length < MIN_SECRET_LENGTH) throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters`)
  return value
}

function assertDistinct(values: ReadonlyMap<string, string>): void {
  const owners = new Map<string, string>()
  for (const [name, value] of values) {
    const owner = owners.get(value)
    if (owner) throw new Error(`${name} must differ from ${owner}`)
    owners.set(value, name)
  }
}

function valueArg(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
}

function numberValue(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}
