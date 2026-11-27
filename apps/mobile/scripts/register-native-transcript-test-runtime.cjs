/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require('node:module')
const path = require('node:path')

const webRoot = path.resolve(__dirname, '../../..')
const sharedReact = require.resolve('react', { paths: [webRoot] })
const sharedReactVersion = require(require.resolve('react/package.json', { paths: [webRoot] })).version
const sharedReactDomVersion = require(require.resolve('react-dom/package.json', { paths: [webRoot] })).version
const sharedTestRendererVersion = require(require.resolve('react-test-renderer/package.json', { paths: [webRoot] })).version
if (sharedReactVersion !== sharedReactDomVersion || sharedReactVersion !== sharedTestRendererVersion) {
  throw new Error('Pinned Web React, React DOM, and test renderer versions must match.')
}
const load = Module._load

Module._load = function loadSharedReact(request, parent, isMain) {
  return load.call(this, request === 'react' ? sharedReact : request, parent, isMain)
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true
