import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-public-secret-scan-'))
const archive = path.join(temporary, 'source.tar')
const snapshot = path.join(temporary, 'snapshot')
const failures = []
const sourceTree = process.env.OVERLAY_PUBLIC_SOURCE_TREE?.trim() || 'HEAD'
const excludedSnapshotDirectories = new Set([
  '.build',
  '.cache',
  '.git',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out'
])

if (sourceTree !== 'HEAD' && !/^[0-9a-f]{40}$/i.test(sourceTree)) {
  throw new Error('OVERLAY_PUBLIC_SOURCE_TREE must be HEAD or a full Git tree hash')
}

try {
  fs.mkdirSync(snapshot)
  const hasGitRepository = isGitRepository(root)
  if (hasGitRepository) {
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, sourceTree], {
      cwd: root,
      stdio: 'pipe'
    })
    execFileSync('tar', ['-xf', archive, '-C', snapshot], { stdio: 'pipe' })
  } else {
    if (sourceTree !== 'HEAD') {
      throw new Error('A Git tree hash cannot be selected from a history-free export')
    }
    fs.cpSync(root, snapshot, {
      recursive: true,
      filter: (source) => {
        if (source === root) return true
        const relative = path.relative(root, source)
        return !relative
          .split(path.sep)
          .some((segment) => excludedSnapshotDirectories.has(segment))
      }
    })
  }

  const sensitiveNames =
    /(^|\/)(?:\.env\.(?!example$)|.*\.(?:pem|p12|pfx|mobileprovision)|id_(?:rsa|ed25519)|credentials?\.json)$/i
  const highConfidenceSecrets = [
    ['AWS access key', /AKIA[0-9A-Z]{16}/g],
    ['GitHub token', /gh[opsu]_[A-Za-z0-9]{30,}/g],
    ['Google API key', /AIza[0-9A-Za-z_-]{30,}/g],
    ['Slack token', /xox[baprs]-[0-9A-Za-z-]{20,}/g],
    ['Stripe live key', /(?:sk|rk)_live_[0-9A-Za-z]{16,}/g],
    ['Stripe webhook secret', /whsec_[0-9A-Za-z]{20,}/g],
    ['OpenAI-style secret', /sk-(?:proj-)?[0-9A-Za-z_-]{20,}/g],
    ['Anthropic secret', /sk-ant-[0-9A-Za-z_-]{20,}/g],
    ['WorkOS secret', /sk_(?:test|prod)_[0-9A-Za-z]{20,}/g]
  ]
  const workstationPathFixtureFiles = new Set([
    'scripts/check-public-source-secrets.mjs',
    'scripts/verify-macos-artifact.mjs',
    'src/shared/security/telemetry-redaction.test.ts',
    'src/shared/security/telemetry-redaction.ts'
  ])

  for (const absolute of walk(snapshot)) {
    const relative = path.relative(snapshot, absolute).split(path.sep).join('/')
    if (sensitiveNames.test(relative)) {
      failures.push(`sensitive filename: ${relative}`)
      continue
    }
    const stat = fs.statSync(absolute)
    if (stat.size > 8 * 1024 * 1024) continue
    const bytes = fs.readFileSync(absolute)
    if (bytes.includes(0)) continue
    const content = bytes.toString('utf8')
    if (
      !workstationPathFixtureFiles.has(relative) &&
      /\/Users\/[^/\s]+\/|\/var\/folders\//.test(content)
    ) {
      failures.push(`private workstation path: ${relative}`)
    }
    if (
      content.includes(
        ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')
      )
    ) {
      failures.push(`private key material: ${relative}`)
    }
    for (const [label, pattern] of highConfidenceSecrets) {
      pattern.lastIndex = 0
      if (pattern.test(content)) failures.push(`${label}: ${relative}`)
    }
  }

  if (failures.length) {
    console.error(
      `Public source secret scan failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`
    )
    process.exitCode = 1
  } else {
    console.log(
      hasGitRepository
        ? `Public source secret scan passed for the history-free ${sourceTree === 'HEAD' ? 'HEAD' : 'staged-tree'} export.`
        : 'Public source secret scan passed for the history-free working tree export.'
    )
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}

function isGitRepository(directory) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: directory,
      stdio: 'pipe'
    })
    return true
  } catch {
    return false
  }
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(absolute) : entry.isFile() ? [absolute] : []
  })
}
