/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const WEB_REVISION = '1db4b5e346c89676d205862d6974792dfebf056f'

function prepareWorkspace(root = path.resolve(__dirname, '..')) {
  const parent = path.dirname(root)
  if (
    fs.existsSync(path.join(parent, 'packages/overlay-app-core')) &&
    fs.existsSync(path.join(parent, 'convex/_generated/api.d.ts'))
  )
    return
  const token = process.env.OVERLAY_WEB_READ_TOKEN
  const web = path.join(parent, 'overlay-web-dependencies')
  fs.mkdirSync(web, { recursive: true })
  const env = {
    ...process.env,
    ...(token ? {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0:
        'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + token).toString('base64'),
    } : {}),
    GIT_TERMINAL_PROMPT: '0',
  }
  function git(args) {
    execFileSync('git', args, { cwd: web, env, stdio: 'inherit' })
  }
  git(['init'])
  git(['fetch', '--depth', '1', 'https://github.com/LayerNorm/overlay-web.git', WEB_REVISION])
  git(['checkout', '--detach', 'FETCH_HEAD'])
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: web, stdio: 'inherit' })
  for (const workspace of [
    '@layernorm/overlay-agent-bridge-protocol',
    '@layernorm/overlay-agent-host',
  ])
    execFileSync('npm', ['run', 'build', '--workspace', workspace], { cwd: web, stdio: 'inherit' })
  for (const entry of ['packages', 'src', 'convex', 'config', 'services', 'node_modules']) {
    const target = path.join(parent, entry)
    if (fs.existsSync(target)) throw new Error('Refusing to replace EAS parent path: ' + entry)
    fs.symlinkSync(path.join(web, entry), target, 'dir')
  }
}
if (require.main === module) prepareWorkspace()
module.exports = { prepareWorkspace, WEB_REVISION }
