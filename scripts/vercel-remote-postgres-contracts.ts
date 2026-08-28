import { spawnSync } from 'node:child_process'

const nodeArgs = ['--conditions=react-server', '--import', 'tsx']

function run(args: string[]) {
  const result = spawnSync(process.execPath, [...nodeArgs, ...args], {
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!process.env.OVERLAY_DATABASE_URL) {
  throw new Error('OVERLAY_DATABASE_URL must be injected by the remote Vercel environment')
}

run(['scripts/app-data-migrate.ts'])
run(['--test', 'src/server/app-data/contracts/postgres-contract.test.ts'])

console.log(JSON.stringify({
  ok: true,
  suite: 'postgres-app-data-contracts',
  remote: true,
  schemaMigrated: true,
}))
