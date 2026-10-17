import assert from 'node:assert/strict'
import {mkdtemp, writeFile, readFile, rm, chmod, symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import test from 'node:test'
import {consumePreviewHostingAccess, previewHostingFetch} from './preview-hosting-access.js'

const access = {origin: 'https://pr-247.preview.example.test', secret: 'private-hosting-test-secret'}

test('the built CLI crosses a protected enrollment gate only through its one-shot access file', {skip: process.platform === 'win32' ? 'Cloud bootstrap uses POSIX file permissions' : false}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'preview-cli-')), path = join(directory, 'access.json')
  const execute = promisify(execFile)
  const command = ['--import', fileURLToPath(new URL('fixtures/preview-enrollment-fetch.mjs', import.meta.url)),
    fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 'connect', 'single-use-enrollment-code-1234',
    '--server', access.origin, '--state-dir', directory, '--adapter', 'codex']
  const options = {env: {...process.env, OVERLAY_QA_ENROLL_STATE: directory, VERCEL_AUTOMATION_BYPASS_SECRET: access.secret}, timeout: 15000}
  try {
    await writeFile(path, JSON.stringify(access), {mode: 0o600})
    await assert.rejects(execute(process.execPath, command, options), /Protected deployment/)
    const result = await execute(process.execPath, [...command, '--hosting-auth-file', path], options)
    assert.match(result.stdout, /Connected environment-1/)
    assert.ok(!`${result.stdout}${result.stderr}`.includes(access.secret))
    await assert.rejects(readFile(path), {code: 'ENOENT'})
    const config = await readFile(join(directory, 'config.json'), 'utf8')
    const connection = await readFile(join(directory, 'connection.json'), 'utf8')
    assert.equal(JSON.parse(config).hostingAuthFile, path)
    assert.ok(!`${config}${connection}`.includes(access.secret))
    const requests = (await readFile(join(directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.equal(requests.length, 2)
    assert.ok(requests.every(request => request.hostingAuthenticated && request.accessFileConsumed))
    assert.equal(requests[1].signatureVerified, true)
  } finally {await rm(directory, {recursive: true, force: true})}
})

test('host bootstrap consumes a private origin-bound file before returning its credential', {skip: process.platform === 'win32' ? 'Cloud bootstrap uses POSIX file permissions' : false}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'preview-hosting-')), path = join(directory, 'access.json')
  try {
    await writeFile(path, JSON.stringify(access), {mode: 0o600})
    assert.deepEqual(await consumePreviewHostingAccess(path, `${access.origin}/api/v1/agent-environments`), access)
    await assert.rejects(readFile(path), {code: 'ENOENT'})
  } finally {await rm(directory, {recursive: true, force: true})}
})

test('unsafe file access and foreign or non-HTTPS origins cannot authorize bootstrap', {skip: process.platform === 'win32' ? 'Cloud bootstrap uses POSIX file permissions' : false}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'preview-hosting-')), path = join(directory, 'access.json')
  try {
    await writeFile(path, JSON.stringify(access), {mode: 0o600})
    await chmod(path, 0o644)
    await assert.rejects(consumePreviewHostingAccess(path, access.origin), /private host-owned/)
    await chmod(path, 0o600)
    await assert.rejects(consumePreviewHostingAccess(path, 'https://foreign.example.test'), /configured HTTPS server/)
    await assert.rejects(consumePreviewHostingAccess(path, 'http://pr-247.preview.example.test'), /configured HTTPS server/)
    await symlink(path, join(directory, 'link'))
    await assert.rejects(consumePreviewHostingAccess(join(directory, 'link'), access.origin))
    assert.equal(await readFile(path, 'utf8'), JSON.stringify(access))
  } finally {await rm(directory, {recursive: true, force: true})}
})

test('hosting access stays on the configured API origin, retains application auth and refuses redirects', async () => {
  const requests: Array<{url: string; init?: RequestInit}> = []
  const fetcher = previewHostingFetch(access, async (input, init) => {
    requests.push({url: input.toString(), init}); return new Response('{}')
  })
  const original = {authorization: 'Bearer application-token', 'x-vercel-protection-bypass': 'do-not-forward'}
  for (const url of [`${access.origin}/api/v1/agent-environments/enroll`, `${access.origin}/api/agent-drive`,
    `${access.origin}/api/agent-mcp`, `${access.origin}/not-an-api`, 'https://foreign.example.test/api/agent-mcp',
    'https://pr-247.preview.example.test.evil.test/api/agent-mcp']) await fetcher(url, {headers: original, redirect: 'follow'})
  assert.equal(requests.length, 6)
  for (const [index, request] of requests.entries()) {
    const headers = new Headers(request.init?.headers)
    assert.equal(headers.get('authorization'), original.authorization)
    assert.equal(headers.get('x-vercel-protection-bypass'), index < 3 ? access.secret : null)
    assert.equal(request.init?.redirect, 'error')
  }
  assert.equal(original['x-vercel-protection-bypass'], 'do-not-forward', 'caller headers must not mutate')
})
