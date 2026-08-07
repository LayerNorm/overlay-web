import assert from 'node:assert/strict'
import test from 'node:test'
import { configOverridesFromEnv } from '@/server/config/env-overrides'
import {
  mergeOverlayRuntimeConfig,
  parseOverlayRuntimeConfig,
  redactOverlayRuntimeConfig,
} from '@/shared/config'
import { DEFAULT_OVERLAY_RUNTIME_CONFIG } from '@/shared/config/defaultOverlayRuntimeConfig'

test('SES configuration is server-only, validated, and redacted', () => {
  const override = configOverridesFromEnv({
    NODE_ENV: 'test',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    OVERLAY_EMAIL_PROVIDER: 'ses',
    OVERLAY_EMAIL_FROM: 'Overlay <hello@getoverlay.io>',
    OVERLAY_EMAIL_SES_ACCESS_KEY_ID: 'access-key-value',
    OVERLAY_EMAIL_SES_SECRET_ACCESS_KEY: 'secret-key-value',
    OVERLAY_EMAIL_SES_REGION: 'us-east-1',
    OVERLAY_FEATURE_TRANSACTIONAL_EMAIL: 'true',
  })
  const config = parseOverlayRuntimeConfig(mergeOverlayRuntimeConfig(
    DEFAULT_OVERLAY_RUNTIME_CONFIG,
    { app: { deploymentEnvironment: 'test', baseUrl: 'http://localhost:3000' } },
    override,
  ))

  assert.equal(config.providers.email?.provider, 'ses')
  assert.equal(config.email?.ses.region, 'us-east-1')
  const summary = JSON.stringify(redactOverlayRuntimeConfig(config))
  assert.equal(summary.includes('secret-key-value'), false)
  assert.equal(summary.includes('access-key-value'), false)
})

test('production and on-prem SMTP reject plaintext transport', () => {
  assert.throws(() => parseOverlayRuntimeConfig(mergeOverlayRuntimeConfig(
    DEFAULT_OVERLAY_RUNTIME_CONFIG,
    {
      app: { deploymentEnvironment: 'onprem', baseUrl: 'https://overlay.example.com' },
      providers: { email: { provider: 'smtp' } },
      email: {
        provider: 'smtp',
        from: 'overlay@example.com',
        ses: {},
        smtp: { host: 'smtp.example.com', port: 25, secure: false },
      },
    },
  )), /must use TLS/)
})
