/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const rendererRoot = path.join(projectRoot, 'src', 'renderer', 'src')
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx'])
const ignoredDirs = new Set(['.git', 'dist', 'node_modules', 'out'])
const forbiddenPatterns = [
  {
    label: 'desktop-api-client import',
    pattern: /desktop-api-client/
  },
  {
    label: 'authenticatedAppFetch helper',
    pattern: /authenticatedApp(?:Fetch|FetchResponse|StreamText|Json)/
  }
]

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

for (const filePath of walk(rendererRoot)) {
  const content = fs.readFileSync(filePath, 'utf8')
  for (const forbidden of forbiddenPatterns) {
    if (forbidden.pattern.test(content)) {
      violations.push({
        file: path.relative(projectRoot, filePath),
        label: forbidden.label
      })
    }
  }
}

if (violations.length > 0) {
  console.error(
    'Renderer code must use src/renderer/src/services/app-api-client.ts and @overlay/api-client.'
  )
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.label}`)
  }
  process.exit(1)
}

console.log('Renderer app API calls use the shared desktop app API client surface.')
