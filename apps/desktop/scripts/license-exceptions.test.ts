import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { findRuntimeLicenseException, type RuntimeLicenseException } from './license-exceptions.ts'

const allowlist = (
  JSON.parse(fs.readFileSync(new URL('./license-allowlist.json', import.meta.url), 'utf8')) as {
    runtimeLicenseExceptions: RuntimeLicenseException[]
  }
).runtimeLicenseExceptions

test('OFL-1.1 exception is limited to Geist', () => {
  assert.ok(findRuntimeLicenseException('@fontsource-variable/geist', 'OFL-1.1', allowlist))
  assert.equal(findRuntimeLicenseException('@fontsource-variable/other-font', 'OFL-1.1', allowlist), undefined)
  assert.equal(findRuntimeLicenseException('@fontsource-variable/geist', 'MIT', allowlist), undefined)
})
