import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHROME_EXTENSION_ID } from '@overlay/chrome-bridge'
import { resolveAppOrigin } from '../src/config'

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'))

describe('manifest', () => {
  it('pins the extension id the web app allows to frame it', () => {
    const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
    const id = [...digest].map((char) => String.fromCharCode(97 + parseInt(char, 16))).join('')
    expect(id).toBe(CHROME_EXTENSION_ID)
  })

  it('asks only for what the side panel uses', () => {
    expect(manifest.permissions).toEqual(['sidePanel', 'scripting'])
    // Host access is what lets the framed app keep its overlay.works sign-in, and lets "Add this page" read the tab.
    expect(manifest.host_permissions).toEqual(['https://*/*', 'http://*/*'])
    expect(manifest.externally_connectable).toBeUndefined()
    expect(manifest.content_scripts).toBeUndefined()
  })
})

describe('resolveAppOrigin', () => {
  it('defaults to production and accepts preview and local origins', () => {
    expect(resolveAppOrigin(undefined)).toBe('https://overlay.works')
    expect(resolveAppOrigin('https://pr-12.preview.overlay.works/app')).toBe('https://pr-12.preview.overlay.works')
    expect(resolveAppOrigin('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('refuses plain http elsewhere', () => {
    expect(() => resolveAppOrigin('http://overlay.works')).toThrow()
  })
})
