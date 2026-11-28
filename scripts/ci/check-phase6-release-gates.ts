import { spawnSync } from 'node:child_process'

const commands = [
  ['bun', ['run', 'check:config']],
  ['bun', ['run', 'docs:health']],
  ['bun', ['run', 'license:check']],
  ['bun', ['run', 'check:shared-isomorphic']],
  ['bun', ['run', 'check:module-boundaries']],
  ['bun', ['run', 'check:providers']],
  ['bun', ['run', 'test:phase6-routes']],
  ['bun', ['run', 'typecheck']],
  ['bun', ['run', 'build']],
] as const

for (const [command, args] of commands) {
  const label = [command, ...args].join(' ')
  console.log(`\n[enterprise-release] ${label}`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.error) {
    console.error(`[enterprise-release] ${label} failed: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[enterprise-release] ${label} exited with ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

console.log('\n[enterprise-release] release gate passed')
