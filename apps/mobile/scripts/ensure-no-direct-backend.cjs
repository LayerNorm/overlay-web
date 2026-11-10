/* eslint-disable @typescript-eslint/no-require-imports */
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
    pattern: /users:getUserProfile|users:syncUserProfile|usage:getEntitlements/g,
    message: 'privileged profile and entitlement functions must stay server-owned',
  },
  {
    pattern: /from\s+['"](?:@workos-inc\/|stripe|@ai-sdk\/|openai|anthropic|groq-sdk|@aws-sdk\/|@convex-dev\/)|require\(['"](?:@workos-inc\/|stripe|@ai-sdk\/|openai|anthropic|groq-sdk|@aws-sdk\/|@convex-dev\/)/g,
    message: 'server/provider SDKs must not be imported from overlay-mobile',
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
