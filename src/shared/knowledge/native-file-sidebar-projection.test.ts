import assert from 'node:assert/strict'
import test from 'node:test'
import { projectNativeFileSidebarRows } from './native-file-sidebar-projection'

const visible = { _id: 'visible', name: 'Visible.txt' }
const revoked = { _id: 'revoked', name: 'Revoked.txt' }

test('native sidebar projection only exposes successful, currently authorized query rows', () => {
  assert.deepEqual(projectNativeFileSidebarRows({
    canQuery: true,
    status: 'pending',
  }), [])
  assert.deepEqual(projectNativeFileSidebarRows({
    canQuery: true,
    status: 'error',
    data: { nodes: [visible] },
  }), [])
  assert.deepEqual(projectNativeFileSidebarRows({
    canQuery: false,
    status: 'success',
    data: { nodes: [visible] },
  }), [])
  assert.deepEqual(projectNativeFileSidebarRows({
    canQuery: true,
    status: 'success',
    data: { nodes: [] },
  }), [])
  assert.deepEqual(projectNativeFileSidebarRows({
    canQuery: true,
    status: 'success',
    data: { nodes: [visible] },
  }), [visible])
  assert.deepEqual(projectNativeFileSidebarRows({
    canQuery: true,
    status: 'success',
    data: { nodes: [visible, revoked] },
  }), [visible, revoked])
  const afterRevocation = projectNativeFileSidebarRows({
    canQuery: true,
    status: 'success',
    data: { nodes: [visible] },
  })
  assert.deepEqual(afterRevocation, [visible])
  assert.equal(afterRevocation.some((file) => file._id === revoked._id), false)
})
