import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeAgentProfile, looksLikeSecret, redactSecretText, summarizeAgentProfile } from './index.js'

const file = (path: string, content: string) => ({ path, content })
const FAKE_GH = `ghp_${'a1B2c3D4e5'.repeat(4)}`
const FAKE_ANT = `sk-ant-api03-${'x9Y8z7'.repeat(6)}`

test('instructions, skills, commands, subagents, and output styles are imported as written', () => {
  const result = analyzeAgentProfile('claude-code', [
    file('CLAUDE.md', '# Rules\nBe brief.'),
    file('skills/review/SKILL.md', 'Review carefully.'),
    file('skills/review/scripts/check.sh', 'echo ok'),
    file('commands/ship.md', 'Ship it.'),
    file('agents/scout.md', 'You scout.'),
    file('output-styles/terse.md', 'Terse.'),
  ])
  assert.deepEqual(result.files.map((f) => f.path).sort(), ['CLAUDE.md', 'agents/scout.md', 'commands/ship.md', 'output-styles/terse.md', 'skills/review/SKILL.md', 'skills/review/scripts/check.sh'])
  assert.equal(result.dropped.length, 0)
  const summary = summarizeAgentProfile(result)
  assert.deepEqual({ skills: summary.skills, skillFiles: summary.skillFiles, commands: summary.commands, subagents: summary.subagents, claudeMd: summary.claudeMd }, { skills: 1, skillFiles: 2, commands: 1, subagents: 1, claudeMd: true })
})

test('credentials, history, plugins, and hook scripts are never imported, each with a reason', () => {
  const result = analyzeAgentProfile('claude-code', [
    file('.credentials.json', '{"claudeAiOauth":{"accessToken":"x"}}'),
    file('history.jsonl', '{}'),
    file('projects/p/session.jsonl', '{}'),
    file('plugins/market/skill.md', 'x'),
    file('hooks/capture.sh', 'curl evil'),
    file('skills/ok/.env', 'KEY=1'),
    file('skills/ok/node_modules/x/index.js', 'x'),
    file('skills/ok/id_rsa', 'KEY'),
    file('notes.txt', 'random'),
  ])
  assert.deepEqual(result.files, [])
  const reasons = Object.fromEntries(result.dropped.map((d) => [d.path, d.reason]))
  assert.match(reasons['.credentials.json']!, /never imported/)
  assert.match(reasons['plugins/market/skill.md']!, /Plugins/)
  assert.match(reasons['hooks/capture.sh']!, /run code/)
  assert.match(reasons['skills/ok/.env']!, /credential|dependency/)
  assert.match(reasons['notes.txt']!, /Not part of/)
})

test('paths that escape the folder are refused', () => {
  const result = analyzeAgentProfile('claude-code', [file('../.ssh/id_rsa', 'x'), file('/etc/passwd', 'x'), file('skills/../../x.md', 'x'), file('agents\\..\\x.md', 'x'), file('C:\\x\\a.md', 'x')])
  assert.deepEqual(result.files, [])
  assert.equal(result.dropped.length, 5)
})

test('secret-looking text in an instruction file is redacted and reported, not copied', () => {
  const result = analyzeAgentProfile('claude-code', [file('CLAUDE.md', `Use token ${FAKE_GH} and key ${FAKE_ANT} for the API.\n-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----`)])
  const content = result.files[0]!.content
  assert.doesNotMatch(content, /ghp_|sk-ant-|PRIVATE KEY/)
  assert.match(content, /\[REDACTED\]/)
  assert.deepEqual(result.redactions, [{ path: 'CLAUDE.md', count: 3 }])
})

test('settings keep preferences and lose credentials, commands, plugins, and permission bypass', () => {
  const result = analyzeAgentProfile('claude-code', [file('settings.json', JSON.stringify({
    model: 'opus', theme: 'dark', verbose: true,
    env: { ANTHROPIC_API_KEY: FAKE_ANT }, apiKeyHelper: '/bin/get-key', awsAuthRefresh: 'aws sso login',
    enabledPlugins: { 'a@b': true }, skipDangerousModePermissionPrompt: true,
    permissions: { allow: ['Bash(ls:*)'], defaultMode: 'bypassPermissions' },
    statusLine: { type: 'command', command: '~/bin/status.sh' },
    hooks: { PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: './capture.sh' }] }] },
    note: FAKE_GH,
  }))])
  const settings = JSON.parse(result.files[0]!.content)
  assert.deepEqual(settings, { model: 'opus', theme: 'dark', verbose: true, permissions: { allow: ['Bash(ls:*)'] } })
  assert.deepEqual(result.hooks.map((h) => `${h.kind}:${h.event}`).sort(), ['hook:PostToolUse', 'statusline:statusLine'])
  const dropped = result.dropped.map((d) => d.path).join('|')
  for (const key of ['env', 'apiKeyHelper', 'awsAuthRefresh', 'enabledPlugins', 'skipDangerousModePermissionPrompt', 'permissions.defaultMode', 'note']) assert.match(dropped, new RegExp(key))
})

test('only permission modes that ask are imported, so Overlay approval cards stay the prompt', () => {
  const modes = (mode: string) => JSON.parse(analyzeAgentProfile('claude-code', [file('settings.json', JSON.stringify({ permissions: { allow: ['Bash(ls:*)'], defaultMode: mode } }))]).files[0]!.content).permissions
  for (const mode of ['bypassPermissions', 'dontAsk', 'acceptEdits']) assert.deepEqual(modes(mode), { allow: ['Bash(ls:*)'] }, mode)
  for (const mode of ['default', 'plan']) assert.deepEqual(modes(mode), { allow: ['Bash(ls:*)'], defaultMode: mode }, mode)
})

test('invalid settings JSON is dropped, not guessed at', () => {
  const result = analyzeAgentProfile('claude-code', [file('settings.json', '{nope')])
  assert.deepEqual(result.files, [])
  assert.match(result.dropped[0]!.reason, /JSON/)
})

test('MCP servers keep their shape; token values become placeholders the person is asked for', () => {
  const result = analyzeAgentProfile('claude-code', [file('claude.json', JSON.stringify({
    projects: { '/Users/me/app': { history: ['secret chat'] } }, oauthAccount: { emailAddress: 'me@x.com' },
    mcpServers: {
      github: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: FAKE_GH, LOG_LEVEL: 'info' } },
      linear: { type: 'http', url: 'https://mcp.linear.app/mcp?team=eng&api_key=abcdefghijklmnopqrstuvwxyz0123', headers: { Authorization: `Bearer ${FAKE_ANT}`, 'X-Region': 'us' } },
      local: { command: '/Users/me/bin/server', args: ['--token', FAKE_GH] },
      'bad name!': { command: 'x' },
    },
  }))])
  assert.deepEqual(result.files, [])
  assert.deepEqual(Object.keys(result.mcpServers).sort(), ['github', 'linear', 'local'])
  assert.deepEqual(result.mcpServers.github, { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}', LOG_LEVEL: 'info' } })
  assert.equal((result.mcpServers.linear!.headers as Record<string, string>).Authorization, 'Bearer ${LINEAR_AUTHORIZATION}')
  assert.equal((result.mcpServers.linear!.headers as Record<string, string>)['X-Region'], 'us')
  assert.match(String(result.mcpServers.linear!.url), /api_key=\$\{LINEAR_API_KEY\}/)
  assert.match(String(result.mcpServers.linear!.url), /team=eng/)
  assert.deepEqual((result.mcpServers.local!.args as string[])[1], '${LOCAL_ARG_1}')
  assert.deepEqual(result.secrets.map((s) => s.name).sort(), ['GITHUB_PERSONAL_ACCESS_TOKEN', 'LINEAR_API_KEY', 'LINEAR_AUTHORIZATION', 'LOCAL_ARG_1'])
  assert.ok(result.dropped.some((d) => d.path === 'MCP server bad name!'))
  assert.ok(result.warnings.some((w) => /path on your computer/.test(w.message)))
  // Nothing from the rest of ~/.claude.json (history, account) is carried.
  assert.doesNotMatch(JSON.stringify(result), /secret chat|me@x\.com|ghp_|sk-ant-/)
})

test('Codex: instructions and prompts import; credentials, trusted paths, and notify commands do not', () => {
  const toml = [
    'model = "gpt-5"', `experimental_bearer_token = "${FAKE_ANT}"`, 'notify = ["bash", "-c", "curl x"]', '',
    '[projects."/Users/me/app"]', 'trust_level = "trusted"', '',
    '[mcp_servers.docs]', 'command = "npx"', 'bearer_token_env_var = "DOCS_TOKEN"', '',
    '[mcp_servers.docs.env]', `API_KEY = "${FAKE_GH}"`, 'REGION = "us"',
  ].join('\n')
  const result = analyzeAgentProfile('codex', [file('AGENTS.md', 'Be careful.'), file('config.toml', toml), file('prompts/plan.md', 'Plan.'), file('auth.json', '{"OPENAI_API_KEY":"x"}')])
  assert.deepEqual(result.files.map((f) => f.path).sort(), ['AGENTS.md', 'config.toml', 'prompts/plan.md'])
  const config = result.files.find((f) => f.path === 'config.toml')!.content
  assert.match(config, /model = "gpt-5"/)
  assert.match(config, /bearer_token_env_var = "DOCS_TOKEN"/)
  assert.match(config, /REGION = "us"/)
  assert.doesNotMatch(config, /experimental_bearer_token|ghp_|sk-ant-|projects|notify|trust_level/)
  assert.deepEqual(result.hooks.map((h) => h.kind), ['notify'])
  assert.ok(result.dropped.some((d) => /auth\.json/.test(d.path)))
})

test('size limits drop what does not fit, and the same file cannot be listed twice', () => {
  const big = 'a '.repeat(200_000)
  const result = analyzeAgentProfile('claude-code', [file('CLAUDE.md', big), file('agents/a.md', 'ok'), file('agents/a.md', 'again')])
  assert.deepEqual(result.files.map((f) => f.path), ['agents/a.md'])
  assert.ok(result.dropped.some((d) => d.path === 'CLAUDE.md' && /Larger than/.test(d.reason)))
  assert.ok(result.dropped.some((d) => d.reason === 'Listed twice.'))
})

test('secret detection catches known token shapes and opaque tokens, not ordinary text or paths', () => {
  for (const value of [FAKE_GH, FAKE_ANT, 'AKIAABCDEFGHIJKLMNOP', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r', 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6']) assert.equal(looksLikeSecret(value), true, value.slice(0, 20))
  for (const value of ['hello world', 'info', '/usr/local/bin/something-long-with-digits-123456789', 'https://example.com/a/b/c', 'camelCaseIdentifierWithoutDigits']) assert.equal(looksLikeSecret(value), false, value)
  assert.deepEqual(redactSecretText('plain text'), { text: 'plain text', count: 0 })
})
