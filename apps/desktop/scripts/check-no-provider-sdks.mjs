import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const forbidden =
  /^(?:ai|convex|openai|groq-sdk|@ai-sdk\/.*|@openrouter\/.*|@anthropic-ai\/.*|@composio\/.*|@google\/genai)$/
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
  assert.ok(!forbidden.test(name), `Provider SDK is prohibited: ${name}`)
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) walk(path)
    else if (/\.[cm]?[jt]sx?$/.test(path)) {
      const source = readFileSync(path, 'utf8')
      for (const match of source.matchAll(/(?:from\s*|import\s*\(|require\s*\()["']([^"']+)["']/g))
        assert.ok(!forbidden.test(match[1]), `${path}: prohibited SDK ${match[1]}`)
    }
  }
}
walk('src/main')
console.log('Native-only desktop boundary passed.')
