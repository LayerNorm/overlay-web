import assert from 'node:assert/strict'
import test from 'node:test'
import { linkifySourceCitationsMarkdown } from './source-citations'

test('source citation labels persist so a reloaded chat keeps its names', () => {
  assert.equal(
    linkifySourceCitationsMarkdown(
      'Answer\n\n**Sources:** [1] [2]',
      {
        '1': { kind: 'memory', sourceId: 'mem_1', title: 'User loves Celsius' },
        '2': { kind: 'file', sourceId: 'file_2', title: 'Roadmap.md' },
      },
    ),
    'Answer\n\n**Sources:** [1](/app/settings?section=memories&memory=mem_1 "User loves Celsius")'
      + ' [2](/app/files?file=file_2 "Roadmap.md")',
  )
})

test('source citation links persist as internal Overlay markdown links', () => {
  assert.equal(
    linkifySourceCitationsMarkdown(
      'Answer\n\n**Sources:** [1] [2]',
      {
        '1': { kind: 'memory', sourceId: 'memory one' },
        '2': { kind: 'file', sourceId: 'file/two' },
      },
    ),
    'Answer\n\n**Sources:** [1](/app/settings?section=memories&memory=memory%20one) [2](/app/files?file=file%2Ftwo)',
  )
})
