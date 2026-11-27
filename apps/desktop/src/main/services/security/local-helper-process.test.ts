import { describe, expect, it } from 'vitest'
import { createLocalHelperEnvironment } from './local-helper-process'

describe('local helper process security', () => {
  it('passes only the minimal runtime environment to native helpers', () => {
    expect(
      createLocalHelperEnvironment({
        HOME: '/Users/test',
        PATH: '/usr/bin:/bin',
        TMPDIR: '/tmp/test',
        LANG: 'en_US.UTF-8',
        OPENAI_API_KEY: 'must-not-leak',
        INTERNAL_API_SECRET: 'must-not-leak',
        DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib'
      })
    ).toEqual({
      HOME: '/Users/test',
      PATH: '/usr/bin:/bin',
      TMPDIR: '/tmp/test',
      LANG: 'en_US.UTF-8'
    })
  })
})
