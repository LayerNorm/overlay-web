import assert from 'node:assert/strict'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'

const baseUrl = required('PROJECT_CHAT_UI_QA_URL').replace(/\/$/, '')
const storageState = path.resolve(required('PROJECT_CHAT_UI_QA_STORAGE_STATE'))
const artifactRoot = path.resolve(
  process.env.PROJECT_CHAT_UI_QA_ARTIFACT_DIR?.trim()
    || 'output/playwright/project-chat-qa',
)
await access(storageState)
await mkdir(artifactRoot, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  storageState,
  viewport: { width: 1440, height: 960 },
})
const primaryPage = await context.newPage()
const secondaryPage = await context.newPage()
const pageErrors: string[] = []
const serverErrors: string[] = []
monitorPage(primaryPage, 'primary')
monitorPage(secondaryPage, 'secondary')

let projectId: string | undefined
const suffix = Date.now()
const projectName = `Project chat QA ${suffix}`

try {
  const session = await context.request.get(`${baseUrl}/api/auth/session`)
  assert.equal(session.ok(), true, `Session endpoint returned ${session.status()}`)
  assert.equal((await session.json() as { authenticated?: boolean }).authenticated, true)

  const capabilities = await context.request.get(`${baseUrl}/api/v1/capabilities`)
  assert.equal(capabilities.ok(), true, `Capabilities endpoint returned ${capabilities.status()}`)
  const capabilityPayload = await capabilities.json() as {
    capabilities?: { chat?: boolean; projects?: boolean }
  }
  assert.equal(capabilityPayload.capabilities?.chat, true)
  assert.equal(capabilityPayload.capabilities?.projects, true)

  const createdProject = await context.request.post(`${baseUrl}/api/v1/projects`, {
    data: { name: projectName },
  })
  assert.equal(createdProject.ok(), true, `Project creation returned ${createdProject.status()}`)
  const createdProjectPayload = await createdProject.json() as {
    id?: string
    project?: { _id?: string }
  }
  projectId = createdProjectPayload.project?._id ?? createdProjectPayload.id
  assert.ok(projectId, 'Project creation did not return a project id')

  const projectUrl = projectHubUrl(projectId, projectName)
  await primaryPage.goto(projectUrl, { waitUntil: 'domcontentloaded' })
  await composer(primaryPage).waitFor()

  const initialConversationIds = new Set(
    (await listProjectConversations(context, projectId)).map((conversation) => conversation._id),
  )
  const stopPrompt = [
    `Two-tab stop marker ${suffix}.`,
    'Write the integers from 1 to 500, one per line, with a short distinct word after each number.',
    'Do not skip, summarize, group, or abbreviate any line.',
  ].join(' ')
  await sendMessage(primaryPage, stopPrompt)

  const stoppedConversation = await waitForNewConversation(
    context,
    projectId,
    initialConversationIds,
  )
  const conversationUrl = projectConversationUrl(projectId, projectName, stoppedConversation._id)
  await secondaryPage.goto(conversationUrl, { waitUntil: 'domcontentloaded' })
  await secondaryPage.getByText(`Two-tab stop marker ${suffix}.`, { exact: false }).waitFor()
  const secondaryStop = secondaryPage.getByRole('button', { name: 'Stop generating' })
  await secondaryStop.waitFor({ timeout: 30_000 })
  await secondaryStop.click()

  const interruptionMarker = '[Interrupted by user. Continue?]'
  await primaryPage.getByText(interruptionMarker, { exact: false }).waitFor({ timeout: 30_000 })
  await secondaryPage.getByText(interruptionMarker, { exact: false }).waitFor({ timeout: 30_000 })
  assert.equal(await primaryPage.getByText('Something went wrong. Please try again.').count(), 0)
  assert.equal(await secondaryPage.getByText('Something went wrong. Please try again.').count(), 0)
  await primaryPage.screenshot({
    path: path.join(artifactRoot, 'project-chat-stop-primary.png'),
    fullPage: true,
  })
  await secondaryPage.screenshot({
    path: path.join(artifactRoot, 'project-chat-stop-secondary.png'),
    fullPage: true,
  })

  const titledConversation = await waitForConversationTitle(
    context,
    projectId,
    stoppedConversation._id,
  )
  assert.notEqual(titledConversation.title.trim().toLowerCase(), 'new chat')
  await secondaryPage.reload({ waitUntil: 'domcontentloaded' })
  await secondaryPage.getByText(interruptionMarker, { exact: false }).waitFor()
  assert.equal(await secondaryPage.getByText('Something went wrong. Please try again.').count(), 0)

  const beforeRecoveryIds = new Set(
    (await listProjectConversations(context, projectId)).map((conversation) => conversation._id),
  )
  await primaryPage.goto(projectUrl, { waitUntil: 'domcontentloaded' })
  await composer(primaryPage).waitFor()
  const recoveryPrompt = [
    `Refresh recovery marker ${suffix}.`,
    'Write 350 numbered lines. Each line must contain the line number and a different common noun.',
    'Do not skip, summarize, group, or abbreviate any line.',
  ].join(' ')
  await sendMessage(primaryPage, recoveryPrompt)
  await primaryPage.getByRole('button', { name: 'Stop generating' }).waitFor({ timeout: 30_000 })

  const recoveryConversation = await waitForNewConversation(
    context,
    projectId,
    beforeRecoveryIds,
  )
  const recoveryUrl = projectConversationUrl(projectId, projectName, recoveryConversation._id)
  await primaryPage.goto(recoveryUrl, { waitUntil: 'domcontentloaded' })
  await primaryPage.getByText(`Refresh recovery marker ${suffix}.`, { exact: false }).waitFor()

  const recoveredText = await waitForCompletedAssistantText(
    context,
    recoveryConversation._id,
  )
  const stableFragment = normalizeWhitespace(recoveredText).slice(0, 80)
  assert.ok(stableFragment.length >= 40, 'Recovered assistant response was too short to verify')
  await waitForNormalizedText(primaryPage, stableFragment)
  await primaryPage.reload({ waitUntil: 'domcontentloaded' })
  await primaryPage.getByText(`Refresh recovery marker ${suffix}.`, { exact: false }).waitFor()
  await waitForNormalizedText(primaryPage, stableFragment)
  await primaryPage.screenshot({
    path: path.join(artifactRoot, 'project-chat-refresh-recovery.png'),
    fullPage: true,
  })

  assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(' | ')}`)
  assert.deepEqual(serverErrors, [], `Server errors: ${serverErrors.join(' | ')}`)
  console.log(JSON.stringify({
    artifactRoot,
    generatedTitle: titledConversation.title,
    multiTabStop: true,
    noGenericStopError: true,
    ok: true,
    refreshRecovery: true,
  }, null, 2))
} finally {
  if (projectId) {
    await context.request.delete(
      `${baseUrl}/api/v1/projects?projectId=${encodeURIComponent(projectId)}`,
    ).catch(() => undefined)
  }
  await context.close()
  await browser.close()
}

type ProjectConversation = {
  _id: string
  title: string
  updatedAt?: number
  lastModified?: number
}

type ConversationMessage = {
  role?: string
  status?: string
  parts?: Array<{ type?: string; text?: string }>
}

function monitorPage(page: Page, label: string): void {
  page.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`))
  page.on('response', (response) => {
    if (response.status() >= 500 && new URL(response.url()).origin === baseUrl) {
      serverErrors.push(
        `${label}: ${response.status()} ${response.request().method()} ${response.url()}`,
      )
    }
  })
}

function composer(page: Page) {
  return page.locator('[role="textbox"][contenteditable="true"]').last()
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const input = composer(page)
  await input.fill(text)
  await page.getByRole('button', { name: 'Send message' }).click()
  await page.getByText(text.split(' ').slice(0, 5).join(' '), { exact: false }).waitFor()
}

async function listProjectConversations(
  context: BrowserContext,
  projectId: string,
): Promise<ProjectConversation[]> {
  const response = await context.request.get(
    `${baseUrl}/api/v1/conversations?projectId=${encodeURIComponent(projectId)}`,
  )
  assert.equal(response.ok(), true, `Conversation list returned ${response.status()}`)
  const payload = await response.json()
  assert.equal(Array.isArray(payload), true, 'Conversation list was not an array')
  return payload as ProjectConversation[]
}

async function waitForNewConversation(
  context: BrowserContext,
  projectId: string,
  previousIds: Set<string>,
  timeoutMs = 30_000,
): Promise<ProjectConversation> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const created = (await listProjectConversations(context, projectId))
      .filter((conversation) => !previousIds.has(conversation._id))
      .sort((a, b) =>
        (b.updatedAt ?? b.lastModified ?? 0) - (a.updatedAt ?? a.lastModified ?? 0))[0]
    if (created) return created
    await delay(250)
  }
  assert.fail('Timed out waiting for the project conversation to be created')
}

async function waitForConversationTitle(
  context: BrowserContext,
  projectId: string,
  conversationId: string,
  timeoutMs = 45_000,
): Promise<ProjectConversation> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const conversation = (await listProjectConversations(context, projectId))
      .find((candidate) => candidate._id === conversationId)
    if (conversation && !['new chat', 'untitled'].includes(conversation.title.trim().toLowerCase())) {
      return conversation
    }
    await delay(500)
  }
  assert.fail(`Timed out waiting for conversation ${conversationId} to receive a generated title`)
}

async function waitForCompletedAssistantText(
  context: BrowserContext,
  conversationId: string,
  timeoutMs = 120_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await context.request.get(
      `${baseUrl}/api/v1/conversations?conversationId=${encodeURIComponent(conversationId)}&messages=true`,
    )
    assert.equal(response.ok(), true, `Conversation messages returned ${response.status()}`)
    const messages = (await response.json() as { messages?: ConversationMessage[] }).messages ?? []
    const assistant = [...messages].reverse().find((message) => message.role === 'assistant')
    const text = assistant?.parts
      ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim()
    if (assistant?.status === 'completed' && text) return text
    await delay(500)
  }
  assert.fail(`Timed out waiting for conversation ${conversationId} to complete`)
}

async function waitForNormalizedText(
  page: Page,
  expected: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = normalizeWhitespace(await page.locator('main').innerText().catch(() => ''))
    if (text.includes(expected)) return
    await delay(250)
  }
  assert.fail(`Timed out waiting for persisted assistant text: ${expected}`)
}

function projectHubUrl(projectId: string, projectName: string): string {
  return `${baseUrl}/app/projects?projectId=${encodeURIComponent(projectId)}&projectName=${encodeURIComponent(projectName)}`
}

function projectConversationUrl(
  projectId: string,
  projectName: string,
  conversationId: string,
): string {
  return `${baseUrl}/app/projects?view=chat&id=${encodeURIComponent(conversationId)}&projectId=${encodeURIComponent(projectId)}&projectName=${encodeURIComponent(projectName)}`
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
