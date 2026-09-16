import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  managedHarnessSandboxProviders,
  resolveManagedHarnessSandboxProvider,
} from './sandbox-providers'

const VERCEL_ENV_KEYS = ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'] as const
const PROVIDER_ENV_KEYS = [...VERCEL_ENV_KEYS, 'DAYTONA_API_KEY'] as const

async function withProviderEnv(
  values: Partial<Record<(typeof PROVIDER_ENV_KEYS)[number], string | undefined>>,
  run: () => void | Promise<void>,
) {
  const previous = Object.fromEntries(PROVIDER_ENV_KEYS.map((key) => [key, process.env[key]]))
  try {
    for (const key of PROVIDER_ENV_KEYS) {
      const value = values[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await run()
  } finally {
    for (const key of PROVIDER_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

const VERCEL_CONFIGURED = {
  VERCEL_TOKEN: 'token',
  VERCEL_TEAM_ID: 'team',
  VERCEL_PROJECT_ID: 'project',
}

test('configured providers are selectable; unconfigured ones are absent', async () => {
  await withProviderEnv({ ...VERCEL_CONFIGURED, DAYTONA_API_KEY: undefined }, () => {
    assert.deepEqual(managedHarnessSandboxProviders(), ['vercel'])
    assert.equal(resolveManagedHarnessSandboxProvider(), 'vercel')
    assert.equal(resolveManagedHarnessSandboxProvider('vercel'), 'vercel')
  })

  await withProviderEnv({ VERCEL_TOKEN: undefined, DAYTONA_API_KEY: 'key' }, () => {
    assert.deepEqual(managedHarnessSandboxProviders(), ['daytona'])
    assert.equal(resolveManagedHarnessSandboxProvider('daytona'), 'daytona')
    assert.throws(
      () => resolveManagedHarnessSandboxProvider(),
      /Vercel Sandbox is not configured/,
    )
  })

  await withProviderEnv({ ...VERCEL_CONFIGURED, DAYTONA_API_KEY: 'key' }, () => {
    assert.deepEqual(managedHarnessSandboxProviders(), ['vercel', 'daytona'])
    assert.equal(resolveManagedHarnessSandboxProvider('daytona'), 'daytona')
  })
})

test('unconfigured or unsupported providers fail loudly instead of being silently selected', async () => {
  await withProviderEnv({ ...VERCEL_CONFIGURED, DAYTONA_API_KEY: undefined }, () => {
    // Box is deliberately excluded: no egress allowlist, keys land in the
    // sandbox env — the error must document that rather than a generic miss.
    assert.throws(
      () => resolveManagedHarnessSandboxProvider('box'),
      /no egress allowlist/i,
    )
    assert.throws(
      () => resolveManagedHarnessSandboxProvider('daytona'),
      /Daytona Sandbox is not configured/,
    )
    assert.throws(
      () => resolveManagedHarnessSandboxProvider('bogus'),
      /not supported/,
    )
  })
})

test('OVERLAY_HARNESS_SANDBOX_PROVIDER override is honored', async () => {
  const previous = process.env.OVERLAY_HARNESS_SANDBOX_PROVIDER
  process.env.OVERLAY_HARNESS_SANDBOX_PROVIDER = 'daytona'
  try {
    await withProviderEnv({ ...VERCEL_CONFIGURED, DAYTONA_API_KEY: 'key' }, () => {
      assert.equal(resolveManagedHarnessSandboxProvider(), 'daytona')
      // An explicit argument still wins over the env override.
      assert.equal(resolveManagedHarnessSandboxProvider('vercel'), 'vercel')
    })
  } finally {
    if (previous === undefined) delete process.env.OVERLAY_HARNESS_SANDBOX_PROVIDER
    else process.env.OVERLAY_HARNESS_SANDBOX_PROVIDER = previous
  }
})
