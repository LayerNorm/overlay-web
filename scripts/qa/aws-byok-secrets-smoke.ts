import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function aws(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('aws', args, { maxBuffer: 1024 * 1024 })
  return stdout.trim()
}

async function main(): Promise<void> {
  const region = process.env.AWS_REGION?.trim() || await aws(['configure', 'get', 'region'])
  if (!region) throw new Error('AWS_REGION or a default AWS CLI region is required')

  const identity = JSON.parse(await aws(['sts', 'get-caller-identity', '--output', 'json', '--region', region])) as {
    Account: string
    Arn: string
  }
  const prefix = (process.env.OVERLAY_AWS_SECRETS_PREFIX?.trim() || 'overlay/byok')
    .replace(/^\/+|\/+$/g, '')
  const name = `${prefix}/smoke/${randomUUID()}`
  const initialValue = `overlay-byok-smoke-${randomUUID()}`
  const rotatedValue = `overlay-byok-smoke-rotated-${randomUUID()}`
  let secretId: string | undefined

  try {
    const created = JSON.parse(await aws([
      'secretsmanager', 'create-secret',
      '--name', name,
      '--secret-string', initialValue,
      ...(process.env.OVERLAY_AWS_SECRETS_KMS_KEY_ID?.trim()
        ? ['--kms-key-id', process.env.OVERLAY_AWS_SECRETS_KMS_KEY_ID.trim()]
        : []),
      '--region', region,
      '--output', 'json',
    ])) as { ARN?: string }
    if (!created.ARN) throw new Error('AWS did not return an ARN for the smoke-test secret')
    secretId = created.ARN

    const readInitial = JSON.parse(await aws([
      'secretsmanager', 'get-secret-value', '--secret-id', secretId,
      '--region', region, '--output', 'json',
    ])) as { SecretString?: string }
    if (readInitial.SecretString !== initialValue) throw new Error('Initial BYOK secret read mismatch')

    await aws([
      'secretsmanager', 'put-secret-value', '--secret-id', secretId,
      '--secret-string', rotatedValue,
      '--client-request-token', randomUUID(),
      '--region', region, '--output', 'json',
    ])
    const readRotated = JSON.parse(await aws([
      'secretsmanager', 'get-secret-value', '--secret-id', secretId,
      '--region', region, '--output', 'json',
    ])) as { SecretString?: string }
    if (readRotated.SecretString !== rotatedValue) throw new Error('Rotated BYOK secret read mismatch')

    console.log(JSON.stringify({
      ok: true,
      account: identity.Account,
      principal: identity.Arn,
      region,
      secretName: name,
      operations: ['create', 'read', 'rotate', 'read'],
    }, null, 2))
  } finally {
    if (secretId) {
      await aws([
        'secretsmanager', 'delete-secret', '--secret-id', secretId,
        '--force-delete-without-recovery', '--region', region, '--output', 'json',
      ])
      console.log(JSON.stringify({ ok: true, cleanup: 'force-deleted disposable BYOK smoke secret' }))
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
