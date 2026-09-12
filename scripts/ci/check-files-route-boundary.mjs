import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const routeRoot = 'src/server/app-api/v1/files'
const forbidden = [
  /@\/server\/database\/convex/,
  /\bconvex\.(query|mutation|action)\b/,
  /['"]files\/files:/,
]

function findRouteFiles(dir, prefix = '') {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return findRouteFiles(fullPath, relativePath)
    return entry.isFile() && entry.name === 'route.ts' ? [relativePath] : []
  })
}

const files = findRouteFiles(routeRoot)
const violations = []

for (const file of files) {
  const fullPath = join(routeRoot, file)
  const source = readFileSync(fullPath, 'utf8')
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      violations.push(`${fullPath}: forbidden ${pattern}`)
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join('\n'))
  process.exit(1)
}

console.log('OK: files route modules do not own Convex file access.')
