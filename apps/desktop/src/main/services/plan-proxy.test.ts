import { createServer } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import {
  groupCredentialFiles,
  isCredentialFileName,
  listenForSignInCallback,
  parseStoredPlan,
  PLAN_SIGN_IN,
  renderProxyConfig,
  runPlanSignIn
} from './plan-proxy'

const freePort = () => new Promise<number>((resolve) => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => {
    const address = server.address() as { port: number }
    server.close(() => resolve(address.port))
  })
})

describe('plan proxy configuration', () => {
  it('listens on loopback only with this launch’s secrets and nothing exposed', () => {
    const config = renderProxyConfig({ port: 41234, clientKey: 'ovlp_client', managementKey: 'mgmt"key', authDirectory: '/tmp/a b/credentials' })
    expect(config).toContain('host: "127.0.0.1"')
    expect(config).toContain('port: 41234')
    expect(config).toContain('- "ovlp_client"')
    expect(config).toContain('secret-key: "mgmt\\"key"')
    expect(config).toContain('auth-dir: "/tmp/a b/credentials"')
    expect(config).toMatch(/allow-remote: false/)
    expect(config).toMatch(/disable-control-panel: true/)
    expect(config).toMatch(/discovery:\n {4}enabled: false/)
    expect(config).toMatch(/request-log: false/)
    expect(config).toMatch(/plugins:\n {2}enabled: false/)
  })
})

describe('plan credentials', () => {
  it('sorts credential files into plans by type and keeps the account', () => {
    const grouped = groupCredentialFiles({
      'claude-me@example.com.json': JSON.stringify({ type: 'claude', email: 'me@example.com', refresh_token: 'r1' }),
      'codex-me@example.com-plus.json': JSON.stringify({ type: 'codex', email: 'me@example.com', refresh_token: 'r2' }),
      'gemini-x.json': JSON.stringify({ type: 'gemini' }),
      '.oauth-anthropic-state.oauth': '{}',
      'broken.json': '{',
      '../escape.json': JSON.stringify({ type: 'claude' })
    })
    expect(Object.keys(grouped.claude!.files)).toEqual(['claude-me@example.com.json'])
    expect(grouped.claude!.account).toBe('me@example.com')
    expect(Object.keys(grouped.chatgpt!.files)).toEqual(['codex-me@example.com-plus.json'])
  })

  it('reads back only valid stored plans and safe file names', () => {
    expect(parseStoredPlan(null)).toBeNull()
    expect(parseStoredPlan('nope')).toBeNull()
    expect(parseStoredPlan(JSON.stringify({ account: null, files: {} }))).toBeNull()
    expect(parseStoredPlan(JSON.stringify({ account: 'a', files: { '../../x.json': '{}', 'ok.json': '{}' } }))).toEqual({ account: 'a', files: { 'ok.json': '{}' } })
    expect(isCredentialFileName('kv.db')).toBe(false)
    expect(isCredentialFileName('.hidden.json')).toBe(false)
  })
})

describe('plan sign-in', () => {
  it('hands only the matching redirect to the proxy, on this computer', async () => {
    const port = await freePort()
    const forwarded: string[] = []
    const onCallback = vi.fn()
    const server = await listenForSignInCallback({
      plan: 'claude', state: 'state-1', proxyUrl: 'http://127.0.0.1:9', port, onCallback,
      fetch: (async (url: string) => { forwarded.push(url); return new Response('ok') }) as unknown as typeof fetch
    })
    try {
      const wrong = await fetch(`http://127.0.0.1:${port}/callback?code=c&state=other`)
      expect(wrong.status).toBe(404)
      const right = await fetch(`http://127.0.0.1:${port}/callback?code=c&state=state-1`)
      expect(right.status).toBe(200)
      expect(await right.text()).toContain('You’re signed in')
      expect(forwarded).toEqual(['http://127.0.0.1:9/anthropic/callback?code=c&state=state-1'])
      expect(onCallback).toHaveBeenCalledTimes(1)
    } finally {
      await server.close()
    }
  })

  it('says plainly when another app holds the callback port', async () => {
    const port = await freePort()
    const first = await listenForSignInCallback({ plan: 'chatgpt', state: 's', proxyUrl: 'http://127.0.0.1:9', port })
    try {
      await expect(listenForSignInCallback({ plan: 'chatgpt', state: 's', proxyUrl: 'http://127.0.0.1:9', port })).rejects.toThrow(/Another app is using port/)
    } finally {
      await first.close()
    }
  })

  it('opens the provider page and waits until the proxy has the credential', async () => {
    const paths: string[] = []
    let polls = 0
    const management = vi.fn(async (path: string) => {
      paths.push(path)
      if (path === PLAN_SIGN_IN.chatgpt.authPath) return Response.json({ status: 'ok', url: 'https://auth.openai.com/oauth/authorize?x=1', state: 'abc' })
      polls++
      return Response.json({ status: polls < 2 ? 'wait' : 'ok' })
    })
    const opened: string[] = []
    const close = vi.fn(async () => undefined)
    await runPlanSignIn({
      plan: 'chatgpt', proxyUrl: 'http://127.0.0.1:9', management, signal: new AbortController().signal, pollIntervalMs: 1,
      openBrowser: async (url) => { opened.push(url) },
      listen: async ({ state }) => { expect(state).toBe('abc'); return { close } }
    })
    expect(opened).toEqual(['https://auth.openai.com/oauth/authorize?x=1'])
    expect(paths.filter((path) => path.includes('get-auth-status?state=abc'))).toHaveLength(2)
    expect(close).toHaveBeenCalled()
  })

  it('cancels the pending sign-in and refuses a non-https provider page', async () => {
    const controller = new AbortController()
    const paths: string[] = []
    const management = async (path: string) => {
      paths.push(path)
      if (path === PLAN_SIGN_IN.claude.authPath) return Response.json({ url: 'https://claude.ai/oauth/authorize', state: 's1' })
      controller.abort()
      return Response.json({ status: 'wait' })
    }
    await expect(runPlanSignIn({
      plan: 'claude', proxyUrl: 'http://127.0.0.1:9', management, signal: controller.signal, pollIntervalMs: 1,
      openBrowser: async () => undefined, listen: async () => ({ close: async () => undefined })
    })).rejects.toThrow(/cancelled/)
    expect(paths.at(-1)).toBe('/v8/management/oauth/session?state=s1')

    await expect(runPlanSignIn({
      plan: 'claude', proxyUrl: 'http://127.0.0.1:9', signal: new AbortController().signal,
      management: async () => Response.json({ url: 'http://evil.example/login', state: 's' }),
      openBrowser: async () => undefined, listen: async () => ({ close: async () => undefined })
    })).rejects.toThrow(/Couldn’t start the sign-in/)
  })

  it('reports a failed sign-in', async () => {
    const management = async (path: string) => path === PLAN_SIGN_IN.claude.authPath
      ? Response.json({ url: 'https://claude.ai/oauth/authorize', state: 's' })
      : Response.json({ status: 'error', error: 'Bad request' })
    await expect(runPlanSignIn({
      plan: 'claude', proxyUrl: 'http://127.0.0.1:9', management, signal: new AbortController().signal,
      openBrowser: async () => undefined, listen: async () => ({ close: async () => undefined })
    })).rejects.toThrow(/didn’t finish/)
  })
})
