import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

for (const required of [
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'docs/GATE_A_SOURCE_PUBLICATION_CHECKLIST.md',
  'docs/GATE_B_BINARY_RELEASE_CHECKLIST.md',
  'guides/INDEPENDENT_SECURITY_REVIEW.md',
  'guides/PUBLIC_REPOSITORY_EXPORT.md',
  'guides/RELEASE_PROCESS.md',
  'guides/SECURITY_OPERATIONS.md',
  'SECURITY.md'
]) {
  assert.ok(fs.existsSync(path.join(root, required)), `missing launch control: ${required}`)
}

const releaseWorkflow = read('.github/workflows/release-mac.yml')
const frozenJobs = releaseWorkflow.match(/if:\s*\$\{\{\s*false\s*\}\}/g) ?? []
assert.equal(frozenJobs.length, 2, 'build and publish jobs must remain frozen before Gate B')
assert.match(
  releaseWorkflow,
  /environment:\s*release-macos[\s\S]*environment:\s*release-publish/,
  'release build and publish must use separate protected environments'
)

for (const gate of [
  'docs/GATE_A_SOURCE_PUBLICATION_CHECKLIST.md',
  'docs/GATE_B_BINARY_RELEASE_CHECKLIST.md'
]) {
  const source = read(gate)
  assert.match(source, /\*\*Gate status:\*\*\s+(?:PENDING|APPROVED)/)
  assert.match(source, /Independent reviewer/)
  assert.match(source, /Operations owner/)
}

const securityPolicy = read('SECURITY.md')
assert.match(securityPolicy, /Private Vulnerability Reporting/)
assert.match(securityPolicy, /divyansh@layernorm\.co/)

const publicExport = read('guides/PUBLIC_REPOSITORY_EXPORT.md')
assert.match(publicExport, /Do not make the existing private repository public/)

console.log(
  'Launch controls are present. This check does not approve Gate A, Gate B, publication, or release.'
)
