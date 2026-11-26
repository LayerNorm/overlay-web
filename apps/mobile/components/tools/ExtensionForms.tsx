import React, { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Button, ConfirmationDialog, Form, HStack, Host, Image as Symbol, Picker, SecureField, Section, Spacer, Text, TextField } from '@expo/ui/swift-ui'
import {
  autocorrectionDisabled,
  foregroundStyle,
  frame,
  keyboardType,
  lineLimit,
  pickerStyle,
  tag,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import type { McpAuthType, McpServerSummary, SkillSummary } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { extensionsChanged } from '../../lib/changeSignal'
import {
  createMcpServer,
  createSkill,
  deleteMcpServer,
  deleteSkill,
  listMcpServers,
  listSkills,
  testMcpServer,
  updateMcpServer,
  updateSkill,
} from '../../services/integrationsService'
import { moveToWorkspace } from '../../services/scopeService'
import { moveToWorkspaceConfirmation } from '../../lib/moveToWorkspace'

function SheetChrome({ title, save, children }: { title: string; save: { label: string; disabled: boolean; onPress: () => void }; children: React.ReactNode }) {
  const { theme, isDark } = useTheme()
  const router = useRouter()
  return (
    <>
      <Stack.Screen options={{ title }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Cancel" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="checkmark" variant="prominent" tintColor={theme.foreground as string} accessibilityLabel={save.label} disabled={save.disabled} onPress={save.onPress} />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>{children}</Form>
      </Host>
    </>
  )
}

function Loading({ title }: { title: string }) {
  const { theme } = useTheme()
  return (
    <>
      <Stack.Screen options={{ title }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.muted as string} />
      </View>
    </>
  )
}

// The list hands the tapped record over so the sheet opens without refetching.
const primed = new Map<string, { _id: string }>()
export function primeRecord(record: { _id: string }) {
  primed.set(record._id, record)
}

/** Load one record by id from a list endpoint; `null` id means "new". */
function useRecord<T extends { _id: string }>(id: string | undefined, load: () => Promise<T[]>) {
  const [state, setState] = useState<{ record?: T | null; error?: string }>(() =>
    id && primed.has(id) ? { record: primed.get(id) as T } : {},
  )
  useEffect(() => {
    if (!id || primed.delete(id)) return
    let active = true
    load()
      .then((rows) => { if (active) setState({ record: rows.find((row) => row._id === id) ?? null }) })
      .catch((error) => { if (active) setState({ error: error instanceof Error ? error.message : 'Could not load.' }) })
    return () => { active = false }
  }, [id, load])
  return id ? state : { record: null }
}

/** A destructive row that asks in a native confirmation dialog first. */
function DeleteRow({ label, title, message, onConfirm, symbol = 'trash', destructive = true }: { label: string; title: string; message: string; onConfirm: () => void; symbol?: 'trash' | 'building.2'; destructive?: boolean }) {
  const [asking, setAsking] = useState(false)
  return (
    <Section>
      <Button onPress={() => setAsking(true)}>
        <HStack spacing={12}>
          <Symbol systemName={symbol} size={17} color={destructive ? '#FF3B30' : undefined} />
          <Text modifiers={destructive ? [foregroundStyle('#FF3B30')] : []}>{label}</Text>
          <Spacer />
          {/* The dialog needs an anchor view; a button inside its trigger slot stops taking taps. */}
          <ConfirmationDialog title={title} titleVisibility="visible" isPresented={asking} onIsPresentedChange={setAsking}>
            <ConfirmationDialog.Trigger>
              <Text modifiers={[frame({ width: 1, height: 1 })]}>{' '}</Text>
            </ConfirmationDialog.Trigger>
            <ConfirmationDialog.Actions>
              <Button label={label} role={destructive ? 'destructive' : undefined} onPress={() => { setAsking(false); onConfirm() }} />
            </ConfirmationDialog.Actions>
            <ConfirmationDialog.Message>
              <Text>{message}</Text>
            </ConfirmationDialog.Message>
          </ConfirmationDialog>
        </HStack>
      </Button>
    </Section>
  )
}

/** Personal → Workspace, one-way, after a confirmation. */
function MoveRow({ name, extra, onConfirm }: { name: string; extra?: string; onConfirm: () => void }) {
  const confirmation = moveToWorkspaceConfirmation(name, onConfirm)
  return (
    <DeleteRow
      label={confirmation.label}
      title={confirmation.title}
      message={extra ? `${confirmation.message} ${extra}` : (confirmation.message ?? '')}
      onConfirm={onConfirm}
      symbol="building.2"
      destructive={false}
    />
  )
}

/** `/skill-edit?id=…` */
export function SkillEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { record } = useRecord<SkillSummary>(id, listSkills)
  if (record === undefined) return <Loading title="Skill" />
  return <SkillForm key={record?._id ?? 'new'} skill={record} />
}

function SkillForm({ skill }: { skill: SkillSummary | null }) {
  const router = useRouter()
  const [name, setName] = useState(skill?.name ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [instructions, setInstructions] = useState(skill?.instructions ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const complete = Boolean(name.trim() && description.trim() && instructions.trim())
  const run = async (operation: () => Promise<unknown>, fallback: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await operation()
      extensionsChanged.notify()
      router.back()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback)
    } finally {
      setBusy(false)
    }
  }
  const save = () =>
    void run(
      () => (skill ? updateSkill(skill._id, { name, description, instructions }) : createSkill({ name, description, instructions })),
      'Could not save the skill.',
    )
  return (
    <>
      <SheetChrome title={skill ? 'Edit skill' : 'New skill'} save={{ label: 'Save skill', disabled: busy || !complete, onPress: save }}>
        <Section footer={<Text>{error ?? 'Skills are reusable instructions Overlay can follow. Instructions support Markdown.'}</Text>}>
          <TextField placeholder="Name" defaultValue={name} onValueChange={setName} />
          <TextField placeholder="Description" defaultValue={description} onValueChange={setDescription} />
        </Section>
        <Section title="Instructions">
          <TextField
            placeholder="What should Overlay do?"
            defaultValue={instructions}
            axis="vertical"
            onValueChange={setInstructions}
            modifiers={[lineLimit({ min: 6, max: 20 })]}
          />
        </Section>
        {skill && skill.scope !== 'workspace' ? (
          <MoveRow name={skill.name} onConfirm={() => void run(() => moveToWorkspace('skills', skill._id), 'Could not move the skill to the workspace.')} />
        ) : null}
        {skill ? (
          <DeleteRow
            label="Delete skill"
            title={`Delete “${skill.name}”?`}
            message="Agents and chats will no longer be able to use it."
            onConfirm={() => void run(() => deleteSkill(skill._id), 'Could not delete the skill.')}
          />
        ) : null}
      </SheetChrome>
    </>
  )
}

/** `/mcp-edit?id=…` */
export function McpEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { record } = useRecord<McpServerSummary>(id, listMcpServers)
  if (record === undefined) return <Loading title="MCP server" />
  return <McpForm key={record?._id ?? 'new'} server={record} />
}

function McpForm({ server }: { server: McpServerSummary | null }) {
  const router = useRouter()
  const [name, setName] = useState(server?.name ?? '')
  const [url, setUrl] = useState(server?.url ?? '')
  const [transport, setTransport] = useState<'sse' | 'streamable-http'>(server?.transport ?? 'streamable-http')
  const [authType, setAuthType] = useState<McpAuthType>(server?.authType ?? 'none')
  const [bearer, setBearer] = useState('')
  const [headerName, setHeaderName] = useState('')
  const [headerValue, setHeaderValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const authConfig = (): Record<string, unknown> | undefined => {
    if (authType === 'bearer' && bearer.trim()) return { bearerToken: bearer.trim() }
    if (authType === 'header' && headerName.trim() && headerValue.trim()) return { headerName: headerName.trim(), headerValue: headerValue.trim() }
    return undefined
  }
  const run = async (operation: () => Promise<unknown>, fallback: string, close = true) => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      await operation()
      if (close) {
        extensionsChanged.notify()
        router.back()
      }
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : fallback)
    } finally {
      setBusy(false)
    }
  }
  const save = () =>
    void run(async () => {
      if (server) {
        const patch: Parameters<typeof updateMcpServer>[1] = { name, url, transport, authType }
        const config = authConfig()
        if (config) patch.authConfig = config
        await updateMcpServer(server._id, patch)
      } else {
        await createMcpServer({ name, url, transport, enabled: true, authType, authConfig: authConfig() })
      }
    }, 'Could not save the MCP server.')
  const test = () =>
    void run(async () => {
      const result = await testMcpServer({ url, transport, authType: authType === 'oauth' ? 'none' : authType, authConfig: authConfig() })
      setNote(
        result.requiresAuth
          ? 'The server asked for sign-in. Choose OAuth, save, then connect from the server’s page.'
          : result.ok
            ? `Connection works · ${result.toolCount ?? 0} tools found.`
            : `Connection failed · ${result.error || 'Could not connect.'}`,
      )
    }, 'Connection failed.', false)
  const urlField = [textInputAutocapitalization('never'), autocorrectionDisabled(), keyboardType('url')]
  return (
    <>
      <SheetChrome title={server ? 'Edit MCP server' : 'New MCP server'} save={{ label: 'Save MCP server', disabled: busy || !name.trim() || !url.trim(), onPress: save }}>
        <Section>
          <TextField placeholder="Name" defaultValue={name} onValueChange={setName} />
          <TextField placeholder="https://…" defaultValue={url} onValueChange={setUrl} modifiers={urlField} />
          <Picker label="Transport" selection={transport} onSelectionChange={(value: 'sse' | 'streamable-http') => setTransport(value)} modifiers={[pickerStyle('menu')]}>
            <Text modifiers={[tag('streamable-http')]}>Streamable HTTP</Text>
            <Text modifiers={[tag('sse')]}>Server-sent events</Text>
          </Picker>
        </Section>
        <Section
          title="Authentication"
          footer={authType === 'oauth' ? <Text>Save first, then connect from the server’s page. OAuth needs a saved server to attach tokens to.</Text> : server?.hasAuth ? <Text>A secret is saved. Enter a new one only to replace it.</Text> : undefined}
        >
          <Picker label="Method" selection={authType} onSelectionChange={(value: McpAuthType) => setAuthType(value)} modifiers={[pickerStyle('menu')]}>
            <Text modifiers={[tag('none')]}>None</Text>
            <Text modifiers={[tag('bearer')]}>Bearer token</Text>
            <Text modifiers={[tag('header')]}>Custom header</Text>
            <Text modifiers={[tag('oauth')]}>OAuth</Text>
          </Picker>
          {authType === 'bearer' ? <SecureField placeholder="Bearer token" onValueChange={setBearer} /> : null}
          {authType === 'header' ? (
            <>
              <TextField placeholder="Header name" onValueChange={setHeaderName} modifiers={urlField.slice(0, 2)} />
              <SecureField placeholder="Header value" onValueChange={setHeaderValue} />
            </>
          ) : null}
        </Section>
        <Section footer={note ? <Text>{note}</Text> : undefined}>
          <Button onPress={test} modifiers={[]}>
            <HStack spacing={12}>
              <Symbol systemName="bolt.horizontal" size={17} />
              <Text>Test connection</Text>
              <Spacer />
              {busy ? <Text>…</Text> : null}
            </HStack>
          </Button>
        </Section>
        {server && server.scope !== 'workspace' ? (
          <MoveRow
            name={server.name}
            extra="Its sign-in stays with you: connect it for the workspace and turn it on again after the move."
            onConfirm={() => void run(() => moveToWorkspace('mcp-servers', server._id), 'Could not move the MCP server to the workspace.')}
          />
        ) : null}
        {server ? (
          <DeleteRow
            label="Delete MCP server"
            title={`Delete “${server.name}”?`}
            message="Its tools will no longer be available."
            onConfirm={() => void run(() => deleteMcpServer(server._id), 'Could not delete the MCP server.')}
          />
        ) : null}
      </SheetChrome>
    </>
  )
}
