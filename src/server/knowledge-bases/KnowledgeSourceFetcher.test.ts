import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IntegrationKnowledgeSourceFetcher,
  KnowledgeSourceFetcherRegistry,
  UrlKnowledgeSourceFetcher,
} from './KnowledgeSourceFetcher'
import { KnowledgeBaseServiceError } from './KnowledgeBaseService'

const fetcher = new UrlKnowledgeSourceFetcher()

async function expectRejection(ref: string): Promise<KnowledgeBaseServiceError> {
  try {
    await fetcher.fetch({ ref, userId: 'user-1' })
  } catch (error) {
    assert.ok(error instanceof KnowledgeBaseServiceError, `expected a service error for ${ref}`)
    return error
  }
  throw new Error(`expected ${ref} to be rejected`)
}

test('loopback and private addresses are refused', async () => {
  for (const ref of [
    'http://127.0.0.1/secret',
    'https://localhost/secret',
    'http://10.0.0.5/internal',
    'https://192.168.1.1/admin',
    'http://172.16.0.1/',
  ]) {
    const error = await expectRejection(ref)
    assert.equal(error.statusCode, 400, `${ref} must be rejected as a bad request`)
  }
})

test('connected sources use fixed read-only recipes and extract text', async () => {
  const calls: Array<{ toolId: string; args: unknown; userId: string }> = []
  const fetcher = new IntegrationKnowledgeSourceFetcher('drive', async (request) => {
    calls.push(request)
    return {
      status: 'completed',
      output: { data: { content: 'Drive handbook content' } },
    }
  })
  const result = await fetcher.fetch({
    ref: 'overlay-source:v1:google-drive-file:file-123',
    userId: 'user-1',
  })
  assert.equal(result.content, 'Drive handbook content')
  assert.equal(result.label, 'Google Drive')
  assert.deepEqual(calls, [{
    toolId: 'GOOGLEDRIVE_PARSE_FILE',
    args: { file_id: 'file-123' },
    userId: 'user-1',
  }])
})

test('connected source references cannot inject arbitrary tools or cross kinds', async () => {
  let called = false
  const fetcher = new IntegrationKnowledgeSourceFetcher('connector', async () => {
    called = true
    return { status: 'completed', output: { text: 'unexpected' } }
  })
  await assert.rejects(
    fetcher.fetch({
      ref: 'overlay-source:v1:DELETE_ALL_DATA:anything',
      userId: 'user-1',
    }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 400,
  )
  await assert.rejects(
    fetcher.fetch({
      ref: 'overlay-source:v1:google-drive-file:file-123',
      userId: 'user-1',
    }),
    (error: unknown) => error instanceof KnowledgeBaseServiceError && error.statusCode === 400,
  )
  assert.equal(called, false)
})

test('connected source provider failures remain explicit', async () => {
  const fetcher = new IntegrationKnowledgeSourceFetcher('connector', async () => ({
    status: 'failed',
    error: 'Notion is not connected',
  }))
  await assert.rejects(
    fetcher.fetch({
      ref: 'overlay-source:v1:notion-page:page-123',
      userId: 'user-1',
    }),
    (error: unknown) => (
      error instanceof KnowledgeBaseServiceError &&
      error.statusCode === 502 &&
      /not connected/i.test(error.message)
    ),
  )
})

test('cloud metadata endpoints are refused', async () => {
  const error = await expectRejection('http://169.254.169.254/latest/meta-data/')
  assert.equal(error.statusCode, 400)
})

test('non-http schemes are refused', async () => {
  for (const ref of ['file:///etc/passwd', 'ftp://example.com/a', 'gopher://example.com']) {
    await expectRejection(ref)
  }
})

test('a blank or malformed reference is refused', async () => {
  await expectRejection('')
  await expectRejection('not a url')
})

test('registry reports an explicit not-implemented for disabled kinds', () => {
  const registry = new KnowledgeSourceFetcherRegistry([fetcher])
  assert.equal(registry.supports('url'), true)
  assert.equal(registry.supports('connector'), false)
  assert.equal(registry.require('url').kind, 'url')
  try {
    registry.require('connector')
    throw new Error('expected connector to be unsupported')
  } catch (error) {
    assert.ok(error instanceof KnowledgeBaseServiceError)
    assert.equal(error.statusCode, 501)
    assert.match(error.message, /not enabled in this deployment/)
  }
})

test('an empty registry refuses every external kind', () => {
  const registry = new KnowledgeSourceFetcherRegistry([])
  for (const kind of ['url', 'connector', 'drive'] as const) {
    assert.equal(registry.supports(kind), false)
  }
})
