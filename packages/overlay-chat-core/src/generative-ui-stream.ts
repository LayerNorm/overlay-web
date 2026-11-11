import { createSpecStreamCompiler, type SpecStreamLine } from "@json-render/core"
import { GENERATIVE_UI_MAX_DEPTH, GENERATIVE_UI_MAX_SPEC_BYTES, GENERATIVE_UI_MAX_STRING_LENGTH, validateJsonRenderSpec, type JsonRenderSpecValidation } from "./generative-ui"

export const GENERATIVE_UI_MAX_SPEC_STREAM_BYTES = 128 * 1024
export const GENERATIVE_UI_MAX_SPEC_STREAM_PATCHES = 512

type StreamPatch = { op: 'add' | 'replace'; path: string; value: unknown }
export type JsonRenderSpecStreamCompiler = {
  push(chunk: string): { result: Record<string, unknown>; newPatches: SpecStreamLine[] }
  getResult(): Record<string, unknown>
  finish(): Record<string, unknown>
  reset(): void
}

function hasUnsafeStreamValue(value: unknown, depth = 0): boolean {
  if (depth > GENERATIVE_UI_MAX_DEPTH) return true
  if (typeof value === 'string') return value.length > GENERATIVE_UI_MAX_STRING_LENGTH
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some(item => hasUnsafeStreamValue(item, depth + 1))
  if (value && typeof value === 'object') return Object.entries(value).some(([key, child]) =>
    ['__proto__', 'prototype', 'constructor'].includes(key) || key.length > GENERATIVE_UI_MAX_STRING_LENGTH || hasUnsafeStreamValue(child, depth + 1))
  return false
}

function validateSpecStreamPatch(line: string): StreamPatch {
  if (!line || new TextEncoder().encode(line).byteLength > GENERATIVE_UI_MAX_SPEC_BYTES) throw new Error('Patch line is empty or too large')
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch { throw new Error('Patch line must be valid JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Patch must be an object')
  const patch = parsed as Record<string, unknown>
  if (Object.keys(patch).sort().join(',') !== 'op,path,value' || (patch.op !== 'add' && patch.op !== 'replace')
    || typeof patch.path !== 'string' || hasUnsafeStreamValue(patch.value)) throw new Error('Patch must use only add or replace with a safe value')
  if (!patch.path.startsWith('/') || patch.path.length > 1024 || /~(?![01])/.test(patch.path)) throw new Error('Patch path is not a valid JSON pointer')
  const segments = patch.path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (segments.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('Patch path contains an unsafe key')
  const [root, next] = segments
  const allowed = root === 'root' && segments.length === 1
    || root === 'elements' && (segments.length === 1 || (segments.length >= 2 && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(next!)))
    || root === 'state'
  if (!allowed) throw new Error('Patch path must stay within /root, /elements, or /state')
  return patch as StreamPatch
}

export function createJsonRenderSpecStreamCompiler(): JsonRenderSpecStreamCompiler {
  let compiler = createSpecStreamCompiler<Record<string, unknown>>({})
  let buffer = ''
  let bytes = 0
  let patches = 0
  let seedRoot: string | undefined
  const appendLine = (line: string, result: SpecStreamLine[]) => {
    const parsed = validateSpecStreamPatch(line)
    if (patches === 0) {
      if (parsed.op !== 'add' || parsed.path !== '/root' || typeof parsed.value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(parsed.value)) {
        throw new Error('The first patch must add a canonical root id')
      }
      seedRoot = parsed.value
    } else if (patches === 1) {
      const value = parsed.value as Record<string, unknown> | null
      if (parsed.op !== 'add' || parsed.path !== `/elements/${seedRoot}` || !value || typeof value !== 'object'
        || !['Stack', 'Grid', 'Card'].includes(String(value.type)) || !Array.isArray(value.children)) {
        throw new Error('The second patch must seed the root container element')
      }
    }
    if (++patches > GENERATIVE_UI_MAX_SPEC_STREAM_PATCHES) throw new Error('SpecStream exceeds 512 patches')
    const output = compiler.push(`${JSON.stringify(parsed)}\n`)
    if (output.newPatches.length !== 1) throw new Error('SpecStream compiler rejected a patch')
    result.push(output.newPatches[0]!)
  }
  return {
    push(chunk) {
      bytes += new TextEncoder().encode(chunk).byteLength
      if (bytes > GENERATIVE_UI_MAX_SPEC_STREAM_BYTES) throw new Error('SpecStream exceeds 128 KiB')
      buffer += chunk
      const newPatches: SpecStreamLine[] = []
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        appendLine(buffer.slice(0, newline).replace(/\r$/, ''), newPatches)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
      return { result: compiler.getResult(), newPatches }
    },
    getResult() { return compiler.getResult() },
    finish() {
      if (buffer) {
        const unused: SpecStreamLine[] = []
        appendLine(buffer.replace(/\r$/, ''), unused)
        buffer = ''
      }
      return compiler.getResult()
    },
    reset() {
      compiler = createSpecStreamCompiler<Record<string, unknown>>({})
      buffer = ''
      bytes = 0
      patches = 0
      seedRoot = undefined
    },
  }
}

export function compileJsonRenderSpecStream(stream: string): JsonRenderSpecValidation {
  try {
    const compiler = createJsonRenderSpecStreamCompiler()
    compiler.push(stream)
    const spec = compiler.finish()
    return validateJsonRenderSpec(spec)
  } catch (error) {
    return { ok: false, issues: [{ path: 'specStream', message: error instanceof Error ? error.message : 'Invalid SpecStream' }] }
  }
}
