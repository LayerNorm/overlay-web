/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const ts = require('typescript')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/agentByo.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, require: () => ({}) })
const { buildWorkspaceAgentUpdateInput } = exportsObject

test('description edits omit unchanged legacy, empty and valid avatar colors without mutating the input', () => {
  for (const avatarColor of ['slate', '', '#18181b', '#2563eb']) {
    const input = { description: 'Edited description', avatarColor, avatarShape: 'circle', teamIds: ['team'] }
    const patch = buildWorkspaceAgentUpdateInput(input, avatarColor)
    assert.equal(Object.hasOwn(patch, 'avatarColor'), false)
    assert.equal(patch.description, input.description)
    assert.equal(patch.avatarShape, 'circle')
    assert.equal(patch.teamIds, input.teamIds)
    assert.equal(input.avatarColor, avatarColor)
  }
})

test('a missing stored color represented by the default is omitted until the person picks a new color', () => {
  assert.equal(Object.hasOwn(buildWorkspaceAgentUpdateInput({ avatarColor: '#64748b' }, '#64748b'), 'avatarColor'), false)
  assert.equal(buildWorkspaceAgentUpdateInput({ avatarColor: '#2563eb' }, '#64748b').avatarColor, '#2563eb')
  assert.equal(buildWorkspaceAgentUpdateInput({ avatarColor: '#2563eb' }, 'legacy').avatarColor, '#2563eb')
})
