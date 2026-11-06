import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type * as React from 'react'
import { afterAll, test, vi } from 'vitest'

const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
afterAll(() => {
  if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    update(element: React.ReactElement): void
    unmount(): void
    root: { findByProps(props: Record<string, unknown>): { props: Record<string, unknown> } }
  }
}

test('MCP dialog keeps its create draft when the saved record arrives', async () => {
  const ReactModule = await import('react')
  const passthrough = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children)
  const input = (props: Record<string, unknown>) => ReactModule.createElement('input', props)
  const button = ({ children, ...props }: Record<string, unknown>) => ReactModule.createElement('button', props, children as React.ReactNode)
  const span = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('span', null, children)
  const dialog = ({ children, footer, scopeActions }: { children?: React.ReactNode; footer?: React.ReactNode; scopeActions?: React.ReactNode }) =>
    ReactModule.createElement(ReactModule.Fragment, null, scopeActions, children, footer)
  const field = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('div', null, children)

  vi.doMock('@overlay/ui', () => ({
    Badge: span,
    Button: button,
    Input: input,
    Tabs: passthrough,
    TabsTriggerList: passthrough,
    TabsTrigger: span,
    TabsContent: passthrough,
  }))
  vi.doMock('./shared', () => ({
    DeleteExtensionButton: () => null,
    ExtensionCard: () => null,
    ExtensionDialog: dialog,
    Field: field,
    FieldSelect: () => null,
  }))
  vi.doMock('../shell', () => ({ AppScreenBody: passthrough }))
  vi.doMock('@overlay/app-core/extensions', () => ({
    mcpServerToFormValues: () => ({
      name: '',
      description: '',
      transport: 'streamable-http',
      url: '',
      enabled: true,
      authType: 'none',
      bearerToken: '',
      headerName: '',
      headerValue: '',
      timeoutMs: '',
      defaultToolPolicy: 'allow',
    }),
  }))
  const { McpServerDialog } = await import('./mcp')
  const onSave = async () => ({ ok: true })
  const onDelete = async () => ({ ok: true })
  const onTest = async () => ({ ok: true, message: 'ok' })
  const props = {
    onClose() {},
    onSave,
    onDelete,
    onTest,
  }
  const server = {
    _id: 'mcp_1',
    name: 'Saved server',
    description: '',
    transport: 'streamable-http' as const,
    url: 'https://mcp.example.test',
    enabled: true,
    authType: 'none' as const,
    createdAt: 1,
    updatedAt: 2,
  }
  let renderer!: ReturnType<typeof create>
  await ReactModule.act(async () => {
    renderer = create(ReactModule.createElement(McpServerDialog, { ...props, state: { mode: 'create' } }))
  })
  await ReactModule.act(async () => {
    const nameInput = renderer.root.findByProps({ 'aria-label': 'Name' })
    ;(nameInput.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Draft name' } })
  })
  await ReactModule.act(async () => {
    renderer.update(ReactModule.createElement(McpServerDialog, { ...props, state: { mode: 'edit', server } }))
  })
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Name' }).props.value, 'Draft name')
  await ReactModule.act(async () => renderer.unmount())
})
