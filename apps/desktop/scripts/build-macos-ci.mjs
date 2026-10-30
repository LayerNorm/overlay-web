/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript CI entrypoint. */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'

// electron-builder 26.15.3 uses the certificate password to unlock its randomly
// passworded keychain. Import into an ephemeral keychain with the correct password
// and let the builder use that keychain through its supported CSC_KEYCHAIN option.
const directory = mkdtempSync(join(tmpdir(), 'overlay-signing-'))
const keychain = join(directory, 'build.keychain-db')
let created = false
let previousKeychains
let stage = 'compile'
const run = (command, args, env = process.env) =>
  execFileSync(command, args, { env, stdio: 'inherit' })
const security = (args) => execFileSync('/usr/bin/security', args, { stdio: 'pipe' })
try {
  run('npm', ['run', 'build'])
  const env = { ...process.env }
  if (env.CSC_LINK) {
    stage = 'prepare signing keychain'
    const password = randomBytes(32).toString('hex')
    const certificate = join(directory, 'certificate.p12')
    const source = env.CSC_LINK.trim()
    const bytes =
      isAbsolute(source) && existsSync(source)
        ? readFileSync(source)
        : Buffer.from(source.replace(/^data:[^,]*;base64,/, ''), 'base64')
    if (!bytes.length) throw new Error('empty certificate')
    writeFileSync(certificate, bytes, { mode: 0o600 })
    security(['create-keychain', '-p', password, keychain])
    created = true
    security(['unlock-keychain', '-p', password, keychain])
    security(['set-keychain-settings', '-lut', '21600', keychain])
    security([
      'import',
      certificate,
      '-k',
      keychain,
      '-P',
      env.CSC_KEY_PASSWORD ?? '',
      '-T',
      '/usr/bin/codesign',
      '-T',
      '/usr/bin/productbuild'
    ])
    security(['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', password, keychain])
    previousKeychains = [
      ...security(['list-keychains', '-d', 'user'])
        .toString()
        .matchAll(/"([^"]+)"/g)
    ].map((match) => match[1])
    security(['list-keychains', '-d', 'user', '-s', keychain, ...previousKeychains])
    rmSync(certificate)
    env.CSC_KEYCHAIN = keychain
    delete env.CSC_LINK
    delete env.CSC_KEY_PASSWORD
  }
  stage = 'package, sign and notarize'
  run('npx', ['electron-builder', '--mac', '--arm64', '--publish', 'never'], env)
  if (process.env.CI === 'true' && process.env.CSC_LINK) {
    stage = 'signed clean-profile and upgrade acceptance'
    run(process.execPath, ['scripts/qa/smoke-signed-app.mjs'], {
      CI: 'true', PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR
    })
  }
} catch {
  // Child-process errors contain argv, including keychain/certificate passwords.
  console.error(`macOS CI build failed during ${stage}; signing credentials were not logged.`)
  process.exitCode = 1
} finally {
  if (created) {
    try {
      if (previousKeychains) security(['list-keychains', '-d', 'user', '-s', ...previousKeychains])
      security(['delete-keychain', keychain])
    } catch {
      /* Ephemeral runner also destroys it. */
    }
  }
  rmSync(directory, { recursive: true, force: true })
}
