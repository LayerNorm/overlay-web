import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFileListArgs,
  buildTextFilePartWrites,
  buildUpdateFileArgs,
  normalizeMimeType,
  normalizedPositiveBytes,
  ownedStorageKeysForSubtree,
  parseCreateFileRequest,
  parseSearchTextRequest,
} from './FileServicePayloads'
import { FileServiceError } from './FileServiceErrors'

test('parseCreateFileRequest preserves create-file validation payloads', () => {
  assert.throws(
    () => parseCreateFileRequest({}, 'user_1'),
    (error) =>
      error instanceof FileServiceError &&
      error.statusCode === 400 &&
      error.payload.error === 'name required',
  )
  assert.throws(
    () => parseCreateFileRequest({ name: 'x.txt', storageId: 'legacy' }, 'user_1'),
    (error) =>
      error instanceof FileServiceError &&
      error.statusCode === 400 &&
      error.payload.error === 'Convex file storage is no longer supported. Upload to R2 and pass r2Key from the upload-url flow.',
  )
})

test('parseCreateFileRequest maps exact create-file DTO fields', () => {
  const parsed = parseCreateFileRequest({
    name: 'x.txt',
    type: 'file',
    kind: 'upload',
    parentId: 'parent_1',
    projectId: 'project_1',
    mimeType: 'Text/Plain',
    extension: 'txt',
    conversationId: 'conversation_1',
    turnId: 'turn_1',
    modelId: 'model_1',
    prompt: 'prompt',
    outputType: 'document',
    legacyOutputId: 'old_1',
    textContent: 'hello',
  }, 'user_1')

  assert.deepEqual(parsed.fileArgs, {
    userId: 'user_1',
    name: 'x.txt',
    type: 'file',
    kind: 'upload',
    parentId: 'parent_1',
    projectId: 'project_1',
    mimeType: 'Text/Plain',
    extension: 'txt',
    conversationId: 'conversation_1',
    turnId: 'turn_1',
    modelId: 'model_1',
    prompt: 'prompt',
    outputType: 'document',
    legacyOutputId: 'old_1',
  })
  assert.equal(parsed.textValue, 'hello')
})

test('file list and update DTO builders preserve route-facing mapping', () => {
  assert.deepEqual(buildFileListArgs({
    userId: 'user_1',
    parentId: 'null',
    projectId: 'project_1',
    conversationId: 'conversation_1',
    outputType: 'image',
    kind: 'output',
    cursor: 'cursor_1',
    limit: 25,
    summary: true,
  }), {
    userId: 'user_1',
    parentId: null,
    projectId: 'project_1',
    conversationId: 'conversation_1',
    outputType: 'image',
    kind: 'output',
    cursor: 'cursor_1',
    limit: 25,
    summary: true,
  })

  const update = buildUpdateFileArgs({
    fileId: 'file_1',
    name: 'renamed.txt',
    parentId: '',
    projectId: 'project_1',
    textContent: 'updated',
  }, 'user_1')
  assert.equal(update.content, 'updated')
  assert.equal(typeof update.contentHash, 'string')
  assert.deepEqual({ ...update, contentHash: '<hash>' }, {
    fileId: 'file_1',
    userId: 'user_1',
    name: 'renamed.txt',
    parentId: null,
    projectId: 'project_1',
    content: 'updated',
    contentHash: '<hash>',
  })
})

test('search text parser preserves validation and option defaults', () => {
  assert.throws(
    () => parseSearchTextRequest({ fileIds: [], query: 'x' }),
    (error) => error instanceof FileServiceError && error.payload.error === 'fileIds is required',
  )
  assert.throws(
    () => parseSearchTextRequest({ fileIds: ['file_1'], query: '' }),
    (error) => error instanceof FileServiceError && error.payload.error === 'query is required',
  )

  assert.deepEqual(parseSearchTextRequest({
    fileIds: ['a', 'a', 'b'],
    query: ' beta ',
    contextChars: 100,
    maxMatchesPerFile: 2,
    maxTotalSnippetChars: 2000,
  }), {
    fileIds: ['a', 'b'],
    query: 'beta',
    contextChars: 100,
    maxMatchesPerFile: 2,
    maxTotalSnippetChars: 2000,
  })
})

test('storage and upload policy helpers preserve exact behavior', () => {
  assert.equal(normalizeMimeType('Text/Plain; charset=utf-8'), 'text/plain')
  assert.equal(normalizedPositiveBytes('12.6', { missing: 'sizeBytes required' }), 13)
  assert.throws(
    () => normalizedPositiveBytes(0, { missing: 'sizeBytes required', nonPositive: 'sizeBytes must be greater than 0' }),
    (error) =>
      error instanceof FileServiceError &&
      error.payload.error === 'sizeBytes must be greater than 0',
  )

  assert.deepEqual(ownedStorageKeysForSubtree('user_1', [
    { fileId: 'file_1', r2Key: 'users/user_1/files/file_1/a.txt' },
    { fileId: 'file_2', r2Key: 'users/user_2/files/file_2/b.txt' },
    { fileId: 'file_3', r2Key: 'users/user_1/outputs/out_1/c.txt' },
  ]), [
    'users/user_1/files/file_1/a.txt',
    'users/user_1/outputs/out_1/c.txt',
  ])

  const parts = buildTextFilePartWrites('notes.txt', 'hello')
  assert.equal(parts.length, 1)
  assert.equal(parts[0]?.name, 'notes.txt')
  assert.equal(parts[0]?.content, 'hello')
  assert.equal(typeof parts[0]?.contentHash, 'string')
})
