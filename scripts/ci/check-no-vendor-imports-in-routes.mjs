#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const scanRoots = ['src/app', 'src/features']
const vendorImportPatterns = [
  { label: 'Stripe SDK', pattern: /from\s+['"]stripe['"]|import\s+['"]stripe['"]/ },
  { label: 'WorkOS SDK', pattern: /from\s+['"]@workos-inc\/node['"]|import\s+['"]@workos-inc\/node['"]/ },
  { label: 'AWS SDK', pattern: /from\s+['"]@aws-sdk\// },
  { label: 'OpenRouter SDK', pattern: /from\s+['"]@openrouter\// },
  { label: 'AI SDK provider', pattern: /from\s+['"]@ai-sdk\/(?:anthropic|google|groq|openai|xai)['"]/ },
  { label: 'OpenAI SDK', pattern: /from\s+['"]openai['"]|import\s+['"]openai['"]/ },
  { label: 'Anthropic SDK', pattern: /from\s+['"]@anthropic-ai\// },
  { label: 'Groq SDK', pattern: /from\s+['"]groq-sdk['"]|import\s+['"]groq-sdk['"]/ },
]

const violations = []

for (const root of scanRoots) {
  walk(path.join(repoRoot, root), (file) => {
    if (!/\.(ts|tsx)$/.test(file)) return
    const source = readFileSync(file, 'utf8')
    for (const vendor of vendorImportPatterns) {
      if (vendor.pattern.test(source)) {
        violations.push({
          file: path.relative(repoRoot, file),
          vendor: vendor.label,
        })
      }
    }
  })
}

if (violations.length > 0) {
  console.error('Vendor SDK imports are not allowed in src/app/** or src/features/**.')
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.vendor}`)
  }
  process.exit(1)
}

console.log('No vendor SDK imports found in src/app/** or src/features/**.')

function walk(dir, visit) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      walk(fullPath, visit)
      continue
    }
    if (entry.isFile() || statSync(fullPath).isFile()) {
      visit(fullPath)
    }
  }
}
