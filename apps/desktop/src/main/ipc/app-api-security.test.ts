import { describe, expect, it } from 'vitest'
import {
  appApiPathForLog,
  normalizeAppApiInput,
  sanitizeForwardedHeaders,
  shouldProbeLegacyBearerUserId,
  shouldRecoverAppApiAuthentication
} from './app-api-security'

describe('desktop app API security', () => {
  it('allows only the explicit streaming routes', () => {
    expect(
      normalizeAppApiInput({ path: '/api/v1/conversations/act', method: 'POST' }, { stream: true })
        .path
    ).toBe('/api/v1/conversations/act')
    expect(
      normalizeAppApiInput({ path: '/api/v1/generate-video', method: 'POST' }, { stream: true })
        .path
    ).toBe('/api/v1/generate-video')
    expect(() =>
      normalizeAppApiInput({ path: '/api/v1/generate-image', method: 'POST' }, { stream: true })
    ).toThrow('Unsupported app API stream path')
    expect(() =>
      normalizeAppApiInput({ path: '/api/v1/generate-video', method: 'GET' }, { stream: true })
    ).toThrow('Unsupported app API stream path')
  })

  it('allows environment, binding, and agent lists with scoped mutations', () => {
    for (const path of ['/api/v1/agent-environments', '/api/v1/agent-bindings', '/api/v1/agents']) {
      expect(normalizeAppApiInput({ path, method: 'GET' }).path).toBe(path)
    }
    // Creation and binding mutations are allowlisted; unrelated methods are not.
    expect(
      normalizeAppApiInput({ path: '/api/v1/agents', method: 'POST' }).path
    ).toBe('/api/v1/agents')
    expect(
      normalizeAppApiInput({ path: '/api/v1/agent-bindings', method: 'PUT' }).path
    ).toBe('/api/v1/agent-bindings')
    expect(
      normalizeAppApiInput({ path: '/api/v1/agent-bindings', method: 'DELETE' }).path
    ).toBe('/api/v1/agent-bindings')
    for (const input of [
      { path: '/api/v1/agent-environments', method: 'POST' },
      { path: '/api/v1/agent-environments', method: 'DELETE' },
      { path: '/api/v1/agent-bindings', method: 'POST' },
      { path: '/api/v1/agents', method: 'PATCH' }
    ]) {
      expect(() => normalizeAppApiInput(input)).toThrow('Unsupported app API route')
    }
  })

  it('allows enrollment, approval, root updates, and revocation with matching methods', () => {
    expect(
      normalizeAppApiInput({ path: '/api/v1/agent-environments/enrollment-sessions', method: 'POST' })
        .path
    ).toBe('/api/v1/agent-environments/enrollment-sessions')
    expect(
      normalizeAppApiInput({ path: '/api/v1/agent-environments/env_123/approve', method: 'POST' })
        .path
    ).toBe('/api/v1/agent-environments/env_123/approve')
    expect(
      normalizeAppApiInput({ path: '/api/v1/agent-environments/env_123/roots', method: 'PATCH' })
        .path
    ).toBe('/api/v1/agent-environments/env_123/roots')
    expect(
      normalizeAppApiInput({ path: '/api/v1/agent-environments/env_123/revoke', method: 'POST' })
        .path
    ).toBe('/api/v1/agent-environments/env_123/revoke')
    for (const input of [
      { path: '/api/v1/agent-environments/env_123/approve', method: 'GET' },
      { path: '/api/v1/agent-environments/env_123/roots', method: 'POST' },
      { path: '/api/v1/agent-environments/env_123/credentials', method: 'POST' },
      { path: '/api/v1/agent-environments/../admin', method: 'POST' }
    ]) {
      expect(() => normalizeAppApiInput(input)).toThrow('Unsupported app API route')
    }
  })

  it('allows the workspace list and activation routes', () => {
    expect(normalizeAppApiInput({ path: '/api/v1/workspaces', method: 'GET' }).path).toBe(
      '/api/v1/workspaces'
    )
    expect(
      normalizeAppApiInput({ path: '/api/v1/workspaces', method: 'POST' }).path
    ).toBe('/api/v1/workspaces')
    expect(
      normalizeAppApiInput({ path: '/api/v1/workspaces/active', method: 'POST' }).path
    ).toBe('/api/v1/workspaces/active')
    expect(() =>
      normalizeAppApiInput({ path: '/api/v1/workspaces/active', method: 'GET' })
    ).toThrow('Unsupported app API route')
  })

  it('allows reading, saving, and archiving a single agent by id', () => {
    expect(normalizeAppApiInput({ path: '/api/v1/agents/agent_123', method: 'GET' }).path).toBe(
      '/api/v1/agents/agent_123'
    )
    expect(
      normalizeAppApiInput({ path: '/api/v1/agents/agent_123', method: 'PATCH' }).path
    ).toBe('/api/v1/agents/agent_123')
    expect(
      normalizeAppApiInput({ path: '/api/v1/agents/agent_123', method: 'DELETE' }).path
    ).toBe('/api/v1/agents/agent_123')
    for (const input of [
      { path: '/api/v1/agents/agent_123', method: 'POST' },
      { path: '/api/v1/agents/../admin', method: 'GET' }
    ]) {
      expect(() => normalizeAppApiInput(input)).toThrow('Unsupported app API route')
    }
  })

  it('allows reading and acknowledging conversation notifications', () => {
    expect(
      normalizeAppApiInput({ path: '/api/v1/conversations/notifications', method: 'GET' }).path
    ).toBe('/api/v1/conversations/notifications')
    expect(
      normalizeAppApiInput({ path: '/api/v1/conversations/notifications', method: 'PATCH' }).path
    ).toBe('/api/v1/conversations/notifications')
    expect(() =>
      normalizeAppApiInput({ path: '/api/v1/conversations/notifications', method: 'POST' })
    ).toThrow('Unsupported app API route')
  })

  it('rejects origins, traversal encodings, backslashes, and protocol-relative paths', () => {
    for (const path of [
      'https://evil.example/api/v1/generate-video',
      '//evil.example/api/v1/generate-video',
      '/api/v1/%2e%2e/admin',
      '/api/v1/%2fadmin',
      '/api/v1\\admin'
    ]) {
      expect(() => normalizeAppApiInput({ path, method: 'POST' })).toThrow()
    }
  })

  it('rejects unregistered routes, methods, billing mutations, and dynamic path confusion', () => {
    for (const input of [
      { path: '/api/v1/admin', method: 'GET' },
      { path: '/api/v1/projects', method: 'PUT' },
      { path: '/api/subscription/settings', method: 'POST' },
      { path: '/api/v1/files/not-valid/content/extra', method: 'GET' },
      { path: '/api/v1/files/file_1/content', method: 'POST' }
    ]) {
      expect(() => normalizeAppApiInput(input)).toThrow('Unsupported app API route')
    }
  })

  it('never forwards renderer auth, cookie, proxy, or browser security headers', () => {
    const headers = sanitizeForwardedHeaders({
      authorization: 'Bearer renderer-secret',
      cookie: 'overlay_session=secret',
      'x-overlay-service-auth': 'internal-secret',
      'proxy-authorization': 'secret',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-request-id': 'request-1'
    })
    expect(Object.fromEntries(headers.entries())).toEqual({
      'content-type': 'application/json',
      'x-request-id': 'request-1'
    })
  })

  it('removes queries and fragments from request log labels', () => {
    expect(appApiPathForLog('/api/v1/files?token=secret&email=user@example.com')).toBe(
      '/api/v1/files'
    )
    expect(appApiPathForLog('not a path')).toBe('/not%20a%20path')
  })

  it('refreshes only for an explicit invalid bearer-token challenge', () => {
    expect(
      shouldRecoverAppApiAuthentication(
        new Response(null, {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' }
        })
      )
    ).toBe(true)
    expect(shouldRecoverAppApiAuthentication(new Response(null, { status: 401 }))).toBe(false)
    expect(
      shouldRecoverAppApiAuthentication(
        new Response(null, {
          status: 403,
          headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' }
        })
      )
    ).toBe(false)
  })

  it('probes legacy bearer-plus-user-id auth only for an unchallenged bootstrap 401', () => {
    expect(
      shouldProbeLegacyBearerUserId(
        '/api/v1/bootstrap',
        new Response(null, { status: 401 })
      )
    ).toBe(true)
    expect(
      shouldProbeLegacyBearerUserId(
        '/api/v1/conversations',
        new Response(null, { status: 401 })
      )
    ).toBe(false)
    expect(
      shouldProbeLegacyBearerUserId(
        '/api/v1/bootstrap',
        new Response(null, {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' }
        })
      )
    ).toBe(false)
  })
})
