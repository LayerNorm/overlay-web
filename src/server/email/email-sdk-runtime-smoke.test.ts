import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmailProvider } from './createEmailProvider'
import { mergeOverlayRuntimeConfig, parseOverlayRuntimeConfig } from '@/shared/config'
import { DEFAULT_OVERLAY_RUNTIME_CONFIG } from '@/shared/config/defaultOverlayRuntimeConfig'

test('Email SDK SES adapter loads in the Postgres worker runtime', async () => {
  const config = parseOverlayRuntimeConfig(mergeOverlayRuntimeConfig(
    DEFAULT_OVERLAY_RUNTIME_CONFIG,
    {
      app: { deploymentEnvironment: 'test', baseUrl: 'http://localhost:3000' },
      providers: { email: { provider: 'ses' } },
      email: {
        provider: 'ses',
        from: 'Overlay <hello@example.com>',
        ses: { accessKeyId: 'test', secretAccessKey: 'test', region: 'us-east-1' },
        smtp: {},
      },
    },
  ))
  assert.equal((await createEmailProvider(config)).name, 'ses')
})
