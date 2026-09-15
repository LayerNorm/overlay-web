import 'server-only'

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  managedHarnessSandboxProviders,
  resolveManagedHarnessSandboxProvider,
} from './sandbox-providers'

const VERCEL_ENV_KEYS = ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'] as const

async function withVercelEnv(
  values: Partial<Record<(typeof VERCEL_ENV_KEYS)[number], string | undefined>>,
  run: () => void | Promise<void>,
) {
  const previous = Object.fromEntries(VERCEL_ENV_KEYS.map((key) => [key, process.env[key]]))
  try {
    for (const key of VERCEL_ENV_KEYS) {
      const value = values[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await run()
  } finally {
    for (const key of VERCEL_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

const CONFIGURED = {
  VERCEL_TOKEN: 'token',
  VERCEL_TEAM_ID: 'team',
  VERCEL_PROJECT_ID: 'project',
}

test('vercel is the only selectable provider, and only when credentials exist', async () => {
  await withVercelEnv(CONFIGURED, () => {
    assert.deepEqual(managedHarnessSandboxProviders(), ['vercel'])
    assert.equal(resolveManagedHarnessSandboxProvider(), 'vercel')
    assert.equal(resolveManagedHarnessSandboxProvider('vercel'), 'vercel')
  })

  await withVercelEnv({ VERCEL_TOKEN: undefined }, () => {
    assert.deepEqual(managedHarnessSandboxProviders(), [])
    assert.throws(
      () => resolveManagedHarnessSandboxProvider(),
      /Vercel Sandbox is not configured/,
    )
  })
})

test('unconfigured or future providers fail loudly instead of being silently selected', async () => {
  await withVercelEnv(CONFIGURED, () => {
    assert.throws(
      () => resolveManagedHarnessSandboxProvider('box'),
      /not supported yet/,
    )
    assert.throws(
      () => resolveManagedHarnessSandboxProvider('daytona'),
      /not supported yet/,
    )
  })
})

test('OVERLAY_HARNESS_SANDBOX_PROVIDER override is honored', async () => {
  const previous = process.env.OVERLAY_HARNESS_SANDBOX_PROVIDER
  process.env.OVERLAY_HARNESS_SANDBOX_PROVIDER = 'box'
  try {
    await withVercelEnv(CONFIGURED, () => {
      assert.throws(() => resolveManagedHarnessSandboxProvider(), /not supported yet/)
      // An explicit argument still wins over the env override.
      assert.equal(resolveManagedHarnessSandboxProvider('vercel'), 'vercel')
    })
  } finally {
    if (previous === undefined) delete process.env.OVERLAY_HARNESS_SANDBOX_PROVIDER
    else process.env.OVERLAY_HARNESS_SANDBOX_PROVIDER = previous
  }
})
