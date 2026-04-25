const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])
const ignoredDirs = new Set([
  '.expo',
  'android',
  'ios',
  'node_modules',
])

const forbiddenPatterns = [
  {
    pattern: /convexClient/g,
    message: 'direct convex client usage is forbidden in overlay-mobile',
  },
  {
    pattern: /EXPO_PUBLIC_CONVEX_URL/g,
    message: 'Convex runtime config must not be referenced from overlay-mobile',
  },
  {
    pattern: /users:getUserProfile|users:syncUserProfile|usage:getEntitlements/g,
    message: 'product data must flow through overlay-landing /api/app/* APIs only',
  },
]

function walk(currentPath, files = []) {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name.startsWith('.DS_Store')) continue
    if (ignoredDirs.has(entry.name)) continue

    const absolutePath = path.join(currentPath, entry.name)
    if (entry.isDirectory()) {
      walk(absolutePath, files)
      continue
    }

    if (allowedExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath)
    }
  }

  return files
}

const violations = []

for (const filePath of walk(projectRoot)) {
  const relativePath = path.relative(projectRoot, filePath)
  if (relativePath === path.join('scripts', 'ensure-no-direct-backend.cjs')) {
    continue
  }
  const content = fs.readFileSync(filePath, 'utf8')

  for (const rule of forbiddenPatterns) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(content)) {
      violations.push(`${relativePath}: ${rule.message}`)
    }
  }
}

if (violations.length > 0) {
  console.error('Forbidden backend patterns found:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('No forbidden backend patterns found.')
