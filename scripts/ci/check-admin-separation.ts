import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Guard for ADMIN_CONSOLE_SEPARATION_PLAN stage 3c: the operator console lives
// in apps/admin behind ADMIN_API_SECRET + Convex admin functions. The web app
// must not resurrect admin routes, admin feature code, or the secret's env
// var name inside src/** (or the published API client).

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

const forbiddenDirs = [
  'src/app/api/v1/admin',
  'src/app/app/admin',
  'src/features/admin',
]

const secretToken = 'ADMIN_API_SECRET'
const scanRoots = ['src', 'packages']

async function exists(rel: string): Promise<boolean> {
  try {
    await stat(path.join(root, rel))
    return true
  } catch {
    return false
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      yield* walk(full)
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      yield full
    }
  }
}

async function main() {
  const failures: string[] = []

  for (const rel of forbiddenDirs) {
    if (await exists(rel)) {
      failures.push(`forbidden path exists: ${rel}`)
    }
  }

  for (const scanRoot of scanRoots) {
    const base = path.join(root, scanRoot)
    for await (const file of walk(base)) {
      const source = await readFile(file, 'utf8')
      if (source.includes(secretToken)) {
        failures.push(`${secretToken} referenced in ${path.relative(root, file)}`)
      }
    }
  }

  const administration = await readFile(path.join(root, 'convex/admin/administration.ts'), 'utf8')
  const exports = [...administration.matchAll(/export const (\w+)/g)].map(match => match[1])
  if (exports.length !== 1 || exports[0] !== 'appendAuditByServer') failures.push('Legacy operator endpoints reintroduced in Convex administration')
  const authorization = await readFile(path.join(root, 'convex/admin/authorization.ts'), 'utf8')
  if (/export const \w+ = mutation/.test(authorization)) failures.push('Legacy operator mutation reintroduced in Convex authorization')
  if ((await readFile(path.join(root, 'convex/auth/users.ts'), 'utf8')).includes('export const listUserDirectoryByServer')) failures.push('Legacy operator directory reintroduced')

  if (failures.length > 0) {
    console.error('Admin separation check failed:')
    for (const failure of failures) console.error(`  - ${failure}`)
    console.error(
      'The admin console lives in apps/admin. See docs/plans/ADMIN_CONSOLE_SEPARATION_PLAN.md.',
    )
    process.exit(1)
  }
  console.log('Admin separation check passed.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
