import React, { act } from 'react'
import { createRequire } from 'node:module'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('@overlay/ui/primitives', () => ({
  Button: 'button', Input: 'input', Label: 'label', Textarea: 'textarea',
  Dialog: 'test-dialog', DialogContent: 'div', DialogDescription: 'p',
  DialogFooter: 'footer', DialogHeader: 'header', DialogTitle: 'h2',
}))

import { BugReportDialog } from './BugReportDialog'

type TestNode = {
  props: { open: boolean; onOpenChange(open: boolean): void }
  findByType(type: string): TestNode
}
const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): { root: TestNode; update(element: React.ReactElement): void; unmount(): void }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('the bug report dialog is controlled by the account menu that opens it', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const onOpenChange = vi.fn()
  let renderer!: ReturnType<typeof create>
  await act(() => { renderer = create(<BugReportDialog open={false} onOpenChange={onOpenChange} />) })
  const dialog = () => renderer.root.findByType('test-dialog')
  try {
    expect(dialog().props.open).toBe(false)
    await act(() => renderer.update(<BugReportDialog open onOpenChange={onOpenChange} />))
    expect(dialog().props.open).toBe(true)
    await act(() => dialog().props.onOpenChange(false))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  } finally {
    await act(() => renderer.unmount())
  }
})
