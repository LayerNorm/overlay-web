import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyComputerChoice, applyFolderChoice, isExcludedWorkPath, threadWorkProblem, workDirectoryName,
  type ThreadFolder,
} from './thread-work'

const launch: ThreadFolder = { source: 'overlay', fileId: 'f1', name: 'Launch' }
const repo: ThreadFolder = { source: 'github', repository: 'northwind/web', installationId: 7 }
const macFolder: ThreadFolder = { source: 'mac', environmentId: 'env-a', path: '/Users/me/code/site' }

test('a Mac folder pins the thread to its Mac', () => {
  assert.equal(threadWorkProblem({ computer: { kind: 'cloud' }, folders: [macFolder] }), 'A folder on a Mac can only be used by a thread that runs on that Mac.')
  assert.equal(threadWorkProblem({ computer: { kind: 'mac', environmentId: 'env-b' }, folders: [macFolder] }), 'A folder on a Mac can only be used by a thread that runs on that Mac.')
  assert.equal(threadWorkProblem({ computer: { kind: 'mac', environmentId: 'env-a' }, folders: [macFolder] }), null)
})

test('repositories are cloned only on the cloud computer', () => {
  assert.equal(threadWorkProblem({ folders: [repo] }), null)
  assert.match(threadWorkProblem({ computer: { kind: 'mac', environmentId: 'env-a' }, folders: [repo] }) ?? '', /cloud Computers/)
  assert.equal(threadWorkProblem({ folders: [{ ...repo, repository: '../etc' }] }), 'That repository name isn’t valid.')
})

test('folders are unique and limited', () => {
  assert.equal(threadWorkProblem({ folders: [launch, launch] }), 'A folder is listed twice.')
  const many = Array.from({ length: 6 }, (_, index) => ({ ...launch, fileId: `f${index}` }))
  assert.match(threadWorkProblem({ folders: many }) ?? '', /at most 5/)
})

test('choosing a folder or computer keeps the combination valid', () => {
  assert.deepEqual(applyFolderChoice({ folders: [] }, macFolder), { computer: { kind: 'mac', environmentId: 'env-a' }, folders: [macFolder] })
  assert.deepEqual(applyFolderChoice({ computer: { kind: 'mac', environmentId: 'env-a' }, folders: [] }, repo), { computer: { kind: 'cloud' }, folders: [repo] })
  assert.deepEqual(applyComputerChoice({ computer: { kind: 'mac', environmentId: 'env-a' }, folders: [macFolder, launch] }, { kind: 'cloud' }),
    { computer: { kind: 'cloud' }, folders: [launch] })
  assert.deepEqual(applyComputerChoice({ folders: [repo, launch] }, { kind: 'mac', environmentId: 'env-a' }),
    { computer: { kind: 'mac', environmentId: 'env-a' }, folders: [launch] })
})

test('dependencies, git internals and secrets are never copied', () => {
  for (const path of ['node_modules/a.js', 'src/.git/HEAD', '.env', 'app/.env.local', 'dist/app.js']) assert.equal(isExcludedWorkPath(path), true, path)
  for (const path of ['README.md', '.env.example', 'docs/build-notes.md', 'environment.md']) assert.equal(isExcludedWorkPath(path), false, path)
})

test('folder names are safe path segments', () => {
  assert.equal(workDirectoryName('Q4/Launch: plan'), 'Q4-Launch- plan')
  assert.equal(workDirectoryName('..hidden'), 'hidden')
  assert.equal(workDirectoryName('   '), 'folder')
})
