/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Stylesheet imports are a bundler concern; Node cannot parse them. Component
 * tests that render markdown (which pulls in KaTeX's stylesheet) preload this
 * so the import resolves to an empty module.
 */

const Module = require('node:module')

const originalLoad = Module._load

Module._load = function loadWithStyleNoop(request, parent, isMain) {
  if (/\.(?:css|scss|sass|less)$/.test(request)) {
    return {}
  }
  return originalLoad.call(this, request, parent, isMain)
}
