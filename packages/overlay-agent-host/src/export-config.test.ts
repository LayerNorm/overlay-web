import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
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

test('export-config only reports a locally sanitized summary and never uploads files', async () => {
  const home = await fixtureHome()
  const lines: string[] = []
  try {
    const result = await exportConfig({
      harness: 'claude-code', home, log: (line) => lines.push(line),
    })
    assert.equal(result.uploaded, false)
    assert.doesNotMatch(lines.join('\n'), /ghp_|accessToken|me@x\.com/)
    assert.match(lines.join('\n'), /Collected 5 files/)
    assert.match(lines.join('\n'), /Local dry run only/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('export-config rejects an empty home without contacting a server', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'overlay-export-empty-'))
  try {
    await assert.rejects(exportConfig({ harness: 'claude-code', home: empty, log: () => undefined }), /No Claude Code configuration/)
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
})
