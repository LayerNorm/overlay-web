/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const legacyPrefix = '/api' + '/app'
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'])
const ignoredDirs = new Set(['.git', 'dist', 'node_modules', 'out'])

function walk(currentPath, files = []) {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true })

  for (const entry of entries) {
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
  const content = fs.readFileSync(filePath, 'utf8')
  if (content.includes(legacyPrefix)) {
    violations.push(path.relative(projectRoot, filePath))
  }
}

if (violations.length > 0) {
  console.error(`Legacy ${legacyPrefix} routes are forbidden. Use /api/v1 endpoints.`)
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log(`No legacy ${legacyPrefix} routes found.`)
