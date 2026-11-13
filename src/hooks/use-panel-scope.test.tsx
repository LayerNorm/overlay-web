import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'

const route = vi.hoisted(() => ({ pathname: '/w/team/work', search: 'scope=personal' }))
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}))
vi.mock('@/hooks/use-solo-workspace', () => ({ useIsSoloWorkspace: () => false }))

import { usePanelScope } from './use-panel-scope'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { update(element: React.ReactElement): void; unmount(): void }
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function installWindow(initial: string | null) {
  const store = new Map<string, string>(initial ? [['overlay:panel-scope', initial]] : [])
  const target = new EventTarget()
  const setItem = vi.fn((key: string, value: string) => { store.set(key, value) })
  const fakeWindow = Object.assign(target, {
    localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem },
  })
  vi.stubGlobal('window', fakeWindow)
  return {
    setItem,
    stored: () => store.get('overlay:panel-scope'),
    /** Another tab writes the remembered scope; this tab only hears about it through a storage event. */
    otherTabWrites(scope: string) {
      store.set('overlay:panel-scope', scope)
      target.dispatchEvent(new Event('storage'))
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('a URL scope is remembered once and does not overwrite a scope another tab saved later', () => {
  const storage = installWindow('workspace')
  const seen: string[] = []
  function Harness() {
    seen.push(usePanelScope())
    return null
  }
  let renderer!: ReturnType<typeof create>
  act(() => { renderer = create(<Harness />) })
  expect(storage.setItem).toHaveBeenCalledTimes(1)
  expect(storage.stored()).toBe('personal')

  act(() => storage.otherTabWrites('workspace'))
  act(() => storage.otherTabWrites('workspace'))
  expect(storage.setItem).toHaveBeenCalledTimes(1)
  expect(storage.stored()).toBe('workspace')
  // This tab still shows the scope its own URL names.
  expect(seen.at(-1)).toBe('personal')

  // Its own URL changing scope is remembered again.
  route.search = 'scope=workspace'
  act(() => renderer.update(<Harness />))
  route.search = 'scope=personal'
  act(() => renderer.update(<Harness />))
  expect(storage.setItem).toHaveBeenCalledTimes(2)
  expect(storage.stored()).toBe('personal')
  act(() => renderer.unmount())
})
