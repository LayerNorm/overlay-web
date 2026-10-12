import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { collectProfileFiles, exportConfig } from './export-config'

const FAKE_GH = `ghp_${'a1B2c3D4e5'.repeat(4)}`

async function fixtureHome() {
  const home = await mkdtemp(join(tmpdir(), 'overlay-export-'))
  const claude = join(home, '.claude')
  for (const dir of ['skills/review/scripts', 'skills/node_modules/dep', 'commands', 'agents', 'projects/p', 'plugins/x', 'hooks']) await mkdir(join(claude, dir), { recursive: true })
  await writeFile(join(claude, 'CLAUDE.md'), `# Mine\nToken ${FAKE_GH}`)
  await writeFile(join(claude, 'settings.json'), JSON.stringify({ model: 'opus', env: { K: FAKE_GH } }))
  await writeFile(join(claude, '.credentials.json'), '{"accessToken":"secret"}')
  await writeFile(join(claude, 'skills/review/SKILL.md'), 'Review.')
  await writeFile(join(claude, 'skills/review/scripts/run.sh'), 'echo ok')
  await writeFile(join(claude, 'skills/review/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00]))
  await writeFile(join(claude, 'skills/node_modules/dep/index.js'), 'x')
  await writeFile(join(claude, 'commands/ship.md'), 'Ship.')
  await writeFile(join(claude, 'projects/p/chat.jsonl'), '{"private":"chat"}')
  await writeFile(join(claude, 'plugins/x/skill.md'), 'plugin')
  await writeFile(join(claude, 'hooks/capture.sh'), 'curl http://evil')
  await writeFile(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'me@x.com' }, mcpServers: { gh: { command: 'npx', args: ['server'], env: { GITHUB_TOKEN: FAKE_GH } } } }))
  await symlink('/etc/passwd', join(claude, 'agents/leak.md'))
  return home
}

test('only allowlisted parts of the folder are read: no history, plugins, hooks, credentials, binaries, dependencies, or symlinks', async () => {
  const home = await fixtureHome()
  try {
    const paths = (await collectProfileFiles('claude-code', home)).map((file) => file.path).sort()
    assert.deepEqual(paths, ['CLAUDE.md', 'claude.json', 'commands/ship.md', 'settings.json', 'skills/review/SKILL.md', 'skills/review/scripts/run.sh'])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('export cleans on this computer before anything is sent, and sends gzip with the code', async () => {
  const home = await fixtureHome()
  const lines: string[] = []
  let received: { url: string; auth: string | null; type: string | null; body: { secrets: Array<{ name: string }>; mcpServers: Record<string, { env: Record<string, string> }> } } | null = null
  try {
    const result = await exportConfig({
      harness: 'claude-code', serverUrl: 'https://overlay.test/', code: 'one-time-code', home, log: (line) => lines.push(line),
      fetchImpl: (async (url, init) => {
        const headers = new Headers(init?.headers)
        received = { url: String(url), auth: headers.get('authorization'), type: headers.get('content-type'), body: JSON.parse(gunzipSync(Buffer.from(init!.body as Uint8Array)).toString()) }
        return Response.json({ ok: true })
      }) as typeof fetch,
    })
    assert.equal(result.uploaded, true)
    assert.equal(received!.url, 'https://overlay.test/api/v1/agent-profiles/upload')
    assert.equal(received!.auth, 'Bearer one-time-code')
    assert.equal(received!.type, 'application/gzip')
    const sent = JSON.stringify(received!.body)
    assert.doesNotMatch(sent, /ghp_|credential|accessToken|private|evil|me@x\.com/)
    assert.deepEqual(received!.body.secrets.map((s) => s.name).sort(), ['GITHUB_TOKEN'])
    assert.equal(received!.body.mcpServers.gh.env.GITHUB_TOKEN, '${GITHUB_TOKEN}')
    assert.match(lines.join('\n'), /Collected 5 files/)
    assert.match(lines.join('\n'), /GITHUB_TOKEN were not copied/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a dry run uploads nothing, and an empty home is an error', async () => {
  const home = await fixtureHome()
  const empty = await mkdtemp(join(tmpdir(), 'overlay-export-empty-'))
  let calls = 0
  const fetchImpl = (async () => { calls += 1; return Response.json({}) }) as typeof fetch
  try {
    assert.equal((await exportConfig({ harness: 'claude-code', serverUrl: 'https://x', code: 'c', home, dryRun: true, fetchImpl, log: () => undefined })).uploaded, false)
    assert.equal(calls, 0)
    await assert.rejects(exportConfig({ harness: 'claude-code', serverUrl: 'https://x', code: 'c', home: empty, fetchImpl, log: () => undefined }), /Nothing to import/)
    await assert.rejects(exportConfig({ harness: 'claude-code', serverUrl: 'https://x', code: 'c', home, log: () => undefined, fetchImpl: (async () => Response.json({ error: 'The code expired.' }, { status: 410 })) as typeof fetch }), /code expired/)
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(empty, { recursive: true, force: true })
  }
})
