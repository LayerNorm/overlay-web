import assert from 'node:assert/strict'
import test from 'node:test'
import { getDesktopBridge, isTrustedFrame, methodSchemas, notifyDesktopSignedOut, parseEnvironmentLines, splitCommandLine } from './index'

test('ordinary browser and server rendering have no desktop bridge', () => {
  assert.equal(getDesktopBridge(), null)
})
test('only the pinned origin in the main frame is trusted', () => {
  const origin = 'https://overlay.works'
  assert.equal(isTrustedFrame(`${origin}/app/chat`, true, origin), true)
  for (const url of ['about:blank', 'file:///app.html', 'https://overlay.works.evil.test/app', 'https://evil.test', 'http://overlay.works/app', 'https://www.overlay.works', 'invalid']) assert.equal(isTrustedFrame(url, true, origin), false, url)
  assert.equal(isTrustedFrame(`${origin}/app/chat`, false, origin), false)
})
test('external protocol, panel, enrollment and native input boundaries fail closed', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'overlay://auth/transfer']) assert.equal(methodSchemas['window.openExternal'].safeParse({ url }).success, false)
  assert.equal(methodSchemas['window.openExternal'].safeParse({ url: 'https://example.com' }).success, true)
  for (const count of [-1, 0.1, 100000, '1']) assert.equal(methodSchemas['window.setBadgeCount'].safeParse({ count }).success, false)
  assert.equal(methodSchemas['panels.show'].safeParse({ kind: 'browser' }).success, false)
  assert.equal(methodSchemas['panels.show'].safeParse({ kind: 'chat', url: 'https://evil.test' }).success, false)
  assert.equal(methodSchemas['transcription.transcribe'].safeParse({ audio: new Uint8Array(), mime: 'audio/wav', model: 'parakeet_v2' }).success, false)
  assert.equal(methodSchemas['notifications.show'].safeParse({ title: 'Test', body: '', route: '/app\\evil' }).success, false)
})

test('sign-out outside the shell checks the capability and awaits native cleanup', async () => {
  let hasAuth = false
  let calls = 0
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { overlayDesktop: {
    handshake: async () => ({ capabilities: hasAuth ? ['auth'] : [] }),
    call: async () => { calls++ },
    on: () => () => {},
  } } })
  try {
    await notifyDesktopSignedOut()
    assert.equal(calls, 0)
    hasAuth = true
    await notifyDesktopSignedOut()
    assert.equal(calls, 1)
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})


test('private turns name a key provider, a plan or Overlay, and never carry a secret from the page', () => {
  const schema = methodSchemas['localThreads.send']
  const base = {
    owner: { userId: 'u', workspaceId: 'w' }, threadId: 'private_abc12345', turnId: 't',
    messages: [{ id: 'm', role: 'user', parts: [] }], agent: { name: 'Atlas' }, approvalMode: 'ask',
  }
  for (const provider of ['anthropic', 'openrouter', 'claude', 'chatgpt', 'overlay']) {
    assert.equal(schema.safeParse({ ...base, model: { provider, modelId: 'm' } }).success, true, provider)
  }
  assert.equal(schema.safeParse({ ...base, model: { provider: 'cursor', modelId: 'm' } }).success, false)
  assert.equal(schema.safeParse({ ...base, model: { provider: 'claude', modelId: 'm', apiKey: 'sk-test-1234' } }).success, false)
  assert.equal(schema.safeParse({ ...base, model: { provider: 'overlay', modelId: 'm', token: 'ovmcu_m_x' } }).success, false)
})

test('plans are signed in by provider name only', () => {
  assert.equal(methodSchemas['localThreads.signIn'].safeParse({ provider: 'claude' }).success, true)
  assert.equal(methodSchemas['localThreads.signIn'].safeParse({ provider: 'chatgpt' }).success, true)
  assert.equal(methodSchemas['localThreads.signIn'].safeParse({ provider: 'anthropic' }).success, false)
  assert.equal(methodSchemas['localThreads.signIn'].safeParse({ provider: 'claude', token: 'x' }).success, false)
  assert.equal(methodSchemas['localThreads.signOut'].safeParse({ provider: 'overlay' }).success, false)
  assert.equal(methodSchemas['localThreads.models'].safeParse({ provider: 'chatgpt' }).success, true)
  assert.equal(methodSchemas['localThreads.models'].safeParse({ provider: 'overlay' }).success, false)
  assert.equal(methodSchemas['localThreads.plans'].safeParse(undefined).success, true)
})

test('microphone preferences are additive and bounded', () => {
  const schema = methodSchemas['transcription.configure']
  assert.equal(schema.safeParse({ model: 'cloud' }).success, true)
  assert.equal(schema.safeParse({ model: 'cloud', inputDeviceId: 'auto' }).success, true)
  for (const inputDeviceId of ['', 'x'.repeat(513), 42]) {
    assert.equal(schema.safeParse({ model: 'cloud', inputDeviceId }).success, false)
  }
})

test('local MCP servers: names, environment and the grant flag are bounded', () => {
  const add = methodSchemas['localMcp.add']
  const server = { name: 'Files', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], env: { API_TOKEN: 'secret' } }
  assert.equal(add.safeParse(server).success, true)
  assert.equal(add.safeParse({ ...server, env: { 'NOT VALID': 'x' } }).success, false)
  assert.equal(add.safeParse({ ...server, command: ' ' }).success, false)
  assert.equal(add.safeParse({ ...server, args: Array(101).fill('x') }).success, false)
  assert.equal(add.safeParse({ ...server, id: 'chosen-by-page' }).success, false)
  assert.equal(methodSchemas['localMcp.remove'].safeParse({ id: '' }).success, false)
  const send = methodSchemas['localThreads.send']
  const turn = {
    owner: { userId: 'u', workspaceId: 'w' }, threadId: 'private_1', turnId: 't', messages: [{ id: 'm', role: 'user', parts: [] }],
    model: { provider: 'anthropic', modelId: 'claude' }, approvalMode: 'ask',
  }
  assert.equal(send.safeParse({ ...turn, agent: { name: 'Atlas', localMcp: true } }).success, true)
  // The page names only whether the agent may use them; which servers and their values come from the desktop app.
  assert.equal(send.safeParse({ ...turn, agent: { name: 'Atlas', localMcp: true }, localMcp: [server] }).success, false)
})

test('a typed command line splits like a shell would, without running one', () => {
  assert.deepEqual(splitCommandLine('npx -y @modelcontextprotocol/server-filesystem "/Users/me/My Files"'),
    ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Files'])
  assert.deepEqual(splitCommandLine(`uvx  mcp-server --name='a b' --x=\\"q\\" ""`), ['uvx', 'mcp-server', '--name=a b', '--x="q"', ''])
  assert.deepEqual(splitCommandLine('echo $HOME | cat'), ['echo', '$HOME', '|', 'cat'])
  assert.throws(() => splitCommandLine('npx "unclosed'), /not closed/)
})

test('environment lines become name and value pairs', () => {
  assert.deepEqual(parseEnvironmentLines('# token\nAPI_KEY=abc=def\n\nexport REGION="eu"\n'), { API_KEY: 'abc=def', REGION: 'eu' })
  assert.throws(() => parseEnvironmentLines('not a pair'), /NAME=value/)
})
