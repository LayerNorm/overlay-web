import assert from 'node:assert/strict'
import test from 'node:test'
import { fileMarkdownHref, resolveFileMarkdownLinks, type FileLinkNode } from './file-markdown-links'

const file: FileLinkNode = { _id: 'index', name: 'INDEX.md', type: 'file', parentId: 'task', scope: 'personal', userId: 'owner' }
const node = (id: string, name: string, parentId = 'task'): FileLinkNode => ({ ...file, _id: id, name, parentId })

test('an index resolves sibling, encoded and referenced descendant files by canonical identity', async () => {
  const calls: (string | null)[] = []
  const targets = await resolveFileMarkdownLinks({ file,
    content: '[Guide](./GUIDE.md#intro) [Research][source] [Folder](research/)\n\n[source]: research/source%20notes.md',
    listChildren: async parent => {
      calls.push(parent)
      return parent === 'task' ? [node('guide', 'GUIDE.md'), { ...node('research', 'research'), type: 'folder' }]
        : [node('source', 'source notes.md', 'research')]
    },
  })
  assert.equal(fileMarkdownHref('./GUIDE.md#intro', targets), '?file=guide#intro')
  assert.equal(fileMarkdownHref('research/source%20notes.md', targets), '?file=source')
  assert.equal(fileMarkdownHref('research/', targets), '?folder=research')
  assert.deepEqual(calls.sort(), ['research', 'task'])
})

test('external links and fragments keep their semantics; escaping paths and code examples do not trigger lookups', async () => {
  let lookups = 0
  const targets = await resolveFileMarkdownLinks({ file,
    content: '[Website](https://example.test) [Anchor](#intro) [Escape](../GUIDE.md) [Encoded](%2e%2e/GUIDE.md)\n`[Code](secret.md)`',
    listChildren: async () => { lookups++; return [] },
  })
  assert.equal(targets.size, 0)
  assert.equal(lookups, 0)
  assert.equal(fileMarkdownHref('https://example.test', targets), 'https://example.test')
  assert.equal(fileMarkdownHref('#intro', targets), '#intro')
  for (const href of ['../GUIDE.md', '%2e%2e/GUIDE.md', 'javascript:alert(1)', '//evil.test', '%2Fprivate.md', 'x\\secret.md']) {
    assert.equal(fileMarkdownHref(href, targets), undefined)
  }
})

test('ambiguous, archived, different-parent, different-scope and other-owner files cannot satisfy a relative link', async () => {
  const targets = await resolveFileMarkdownLinks({ file,
    content: '[Duplicate](DUP.md) [Other scope](SHARED.md) [Other parent](ELSE.md) [Archived](OLD.md) [Other owner](OTHER.md)',
    listChildren: async () => [node('a', 'DUP.md'), node('b', 'DUP.md'),
      { ...node('shared', 'SHARED.md'), scope: 'workspace' }, node('else', 'ELSE.md', 'elsewhere'),
      { ...node('old', 'OLD.md'), archivedAt: 1 }, { ...node('other', 'OTHER.md'), userId: 'someone-else' }],
  })
  assert.equal(targets.size, 0)
  assert.equal(fileMarkdownHref('DUP.md', targets), undefined)
})

test('workspace links can target another authorized creator without crossing scope', async () => {
  const targets = await resolveFileMarkdownLinks({ file: { ...file, scope: 'workspace' }, content: '[Shared](GUIDE.md)',
    listChildren: async () => [{ ...node('shared', 'GUIDE.md'), scope: 'workspace', userId: 'coworker' }],
  })
  assert.equal(fileMarkdownHref('GUIDE.md', targets), '?file=shared')
})
