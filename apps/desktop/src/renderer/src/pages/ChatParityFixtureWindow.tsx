import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CHAT_PARITY_FIXTURE_TIMESTAMP,
  CHAT_PARITY_FIXTURE_VERSION,
  CHAT_PARITY_IMAGE_DATA_URL,
  CHAT_PARITY_MEDIA_SCENARIOS,
  CHAT_PARITY_TEXT_SCENARIOS,
  CHAT_PARITY_VIDEO_URL,
  type ChatParityMediaScenario,
  type ChatParityTextScenario
} from '@overlay/chat-core/parity-fixtures'
import type {
  AssistantVisualBlock,
  ConversationMessagePart,
  WebSourceItem
} from '@overlay/chat-core'
import {
  getPerfDebugSnapshot,
  resetPerfDebugSnapshot,
  type PerfDebugSnapshot
} from '@overlay/chat-react'
import { DesktopChatTranscript } from '../components/chat/DesktopChatTranscript'
import { DesktopSourcesPanel } from '../components/chat/DesktopSourcesPanel'
import {
  EmbeddedChatTranscript,
  type EmbeddedChatItem,
  type EmbeddedPlanStep
} from '../components/chat/EmbeddedChatTranscript'
import { DesktopMediaComposerControls } from '../components/chat/DesktopMediaComposerControls'
import {
  canSubmitDesktopMediaDraft,
  useDesktopMediaComposerState
} from '../components/chat/useDesktopMediaComposerState'
import type { Message } from '../components/chat/types'
import { getPanelTheme } from '../hooks/usePanelTheme'

function fixtureVideoBlobUrl(dataUrl: string): string {
  const encoded = dataUrl.split(',', 2)[1] || ''
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
}

const fixtureVideoUrl = fixtureVideoBlobUrl(CHAT_PARITY_VIDEO_URL)

const FIXTURE_IMAGE_MODELS = [
  { id: 'fixture/image-a', name: 'Image A', provider: 'fixture' },
  { id: 'fixture/image-b', name: 'Image B', provider: 'fixture' }
] as const
const FIXTURE_VIDEO_MODELS = [
  {
    id: 'fixture/video-a',
    name: 'Video A',
    provider: 'fixture',
    billingUnit: 'per_video' as const
  },
  {
    id: 'fixture/video-b',
    name: 'Video B',
    provider: 'fixture',
    billingUnit: 'per_video' as const
  }
] as const

const FIXTURE_BROWSER_ITEMS: readonly EmbeddedChatItem[] = [
  { type: 'user', text: 'Summarize this page and verify the primary action.' },
  { type: 'thinking', text: 'Reviewing the current page structure.' },
  {
    type: 'tool_call',
    tool: 'browser_read_page',
    toolInput: { focus: 'primary action' },
    toolResult: 'Page inspected successfully.'
  },
  {
    type: 'plan',
    steps: [
      { id: 1, text: 'Inspect the page', status: 'completed' },
      { id: 2, text: 'Verify the primary action', status: 'pending' }
    ]
  },
  { type: 'text', text: 'The page is ready for the final interaction.' }
]

const FIXTURE_BROWSER_PLAN: readonly EmbeddedPlanStep[] = [
  { id: 1, text: 'Inspect the page', status: 'completed' },
  { id: 2, text: 'Verify the primary action', status: 'pending' }
]

const FIXTURE_NOTEBOOK_ITEMS: readonly EmbeddedChatItem[] = [
  { type: 'user', text: 'Tighten this paragraph without changing its meaning.' },
  { type: 'thinking', text: 'Comparing the original wording.' },
  {
    type: 'tool_call',
    tool: 'notebook_edit_note',
    toolInput: { section: 'Introduction' },
    isLoading: true
  }
]

type FixtureConfig = {
  theme: 'light' | 'dark'
  scenario: string
  width: 390 | 640 | 896
  perf: boolean
}

declare global {
  interface Window {
    __CHAT_PARITY_BASELINE__?: {
      fixtureVersion: string
      platform: 'web' | 'desktop'
      scenario: string
      theme: 'light' | 'dark'
      width: number
      perf: PerfDebugSnapshot
    }
  }
}

function readFixtureConfig(): FixtureConfig {
  const params = new URLSearchParams(window.location.search)
  const requestedWidth = Number(params.get('width'))
  return {
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    scenario: params.get('scenario')?.trim() || 'gallery',
    width: requestedWidth === 390 || requestedWidth === 640 ? requestedWidth : 896,
    perf: params.get('perf') === '1'
  }
}

function resolveFixtureUrl(url: string): string {
  return url === CHAT_PARITY_VIDEO_URL ? fixtureVideoUrl : url
}

async function waitForFixtureAssets(): Promise<void> {
  await document.fonts?.ready
  await Promise.all(
    Array.from(document.images).map(
      (element) =>
        new Promise<void>((resolve) => {
          if (element.complete) {
            resolve()
            return
          }
          element.addEventListener('load', () => resolve(), { once: true })
          element.addEventListener('error', () => resolve(), { once: true })
        })
    )
  )
  await Promise.all(
    Array.from(document.querySelectorAll('video')).map(
      (element) =>
        new Promise<void>((resolve) => {
          if (element.readyState >= HTMLMediaElement.HAVE_METADATA) {
            resolve()
            return
          }
          element.addEventListener('loadedmetadata', () => resolve(), { once: true })
          element.addEventListener('error', () => resolve(), { once: true })
        })
    )
  )
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )
}

function assistantBlockToPart(
  block: AssistantVisualBlock,
  scenarioId: string,
  index: number
): ConversationMessagePart | null {
  const id = `${scenarioId}:part:${index}`
  if (block.kind === 'text') return { type: 'text', id, text: block.text }
  if (block.kind === 'reasoning') {
    return {
      type: 'reasoning',
      id,
      text: block.text,
      state: block.state === 'streaming' ? 'streaming' : 'done'
    }
  }
  if (block.kind === 'tool') {
    const allowedStates = new Set([
      'input-streaming',
      'input-available',
      'input-error',
      'output-available',
      'output-error',
      'output-denied'
    ])
    return {
      type: 'tool',
      id,
      toolCallId: block.key,
      toolName: block.name,
      state: allowedStates.has(block.state)
        ? (block.state as Extract<ConversationMessagePart, { type: 'tool' }>['state'])
        : 'output-available',
      input: block.toolInput,
      output: block.toolOutput
    }
  }
  if (block.kind === 'file') {
    if (!block.mediaType) return null
    return { type: 'file', id, url: resolveFixtureUrl(block.url), mediaType: block.mediaType }
  }
  if (block.kind === 'generated-ui') {
    return { ...block.part, id }
  }
  return null
}

function textScenarioMessages(scenario: ChatParityTextScenario): Message[] {
  const partsForBlocks = (
    blocks: readonly AssistantVisualBlock[],
    variantId: string
  ): ConversationMessagePart[] =>
    blocks
      .map((block, index) => assistantBlockToPart(block, variantId, index))
      .filter((part): part is ConversationMessagePart => Boolean(part))
  const assistantParts = partsForBlocks(scenario.assistantBlocks, scenario.id)

  if (scenario.errorMessage) {
    assistantParts.push({
      type: 'text',
      id: `${scenario.id}:error`,
      text: `Error: ${scenario.errorMessage}`
    })
  } else if (scenario.interrupted) {
    assistantParts.push({
      type: 'text',
      id: `${scenario.id}:interrupted`,
      text: 'Response was interrupted.'
    })
  }

  const variants = scenario.responseVariants
  const selectedResponseIndex = Math.min(
    scenario.selectedResponseIndex ?? 0,
    Math.max(0, (variants?.length ?? 1) - 1)
  )

  return [
    {
      id: `${scenario.id}:user`,
      turnId: `${scenario.id}:turn`,
      role: 'user',
      content: scenario.userText,
      timestamp: CHAT_PARITY_FIXTURE_TIMESTAMP,
      mentions: [
        ...scenario.userDocuments.map((name, index) => ({
          id: `${scenario.id}:document:${index}`,
          type: 'document' as const,
          title: name
        })),
        ...scenario.userMentions.map((mention) => ({
          id: mention.id,
          type: 'file' as const,
          title: mention.name
        }))
      ],
      screenshots: scenario.userImages.map((image, index) => ({
        dataUrl: image.url,
        displayId: `${scenario.id}:image:${index}`,
        name: image.name,
        loadStatus: 'loaded'
      }))
    },
    {
      id: `${scenario.id}:assistant`,
      turnId: `${scenario.id}:turn`,
      role: 'assistant',
      content: '',
      timestamp: CHAT_PARITY_FIXTURE_TIMESTAMP + 1,
      selectedModelId: variants?.[selectedResponseIndex]?.modelId ?? 'openai/gpt-5.2',
      renderParts: assistantParts,
      responses: variants?.map((variant) => ({
        modelId: variant.modelId,
        modelName: variant.modelName,
        provider: variant.modelId.split('/', 1)[0] || 'unknown',
        content: variant.assistantBlocks
          .filter((block) => block.kind === 'text')
          .map((block) => block.text)
          .join('\n\n'),
        isLoading: false,
        renderParts: partsForBlocks(variant.assistantBlocks, `${scenario.id}:${variant.modelId}`)
      }))
    }
  ]
}

function mediaScenarioMessages(scenario: ChatParityMediaScenario): Message[] {
  return [
    {
      id: `${scenario.id}:user`,
      turnId: `${scenario.id}:turn`,
      role: 'user',
      content: scenario.prompt,
      timestamp: CHAT_PARITY_FIXTURE_TIMESTAMP,
      generation: {
        kind: scenario.kind,
        modelIds: [...scenario.modelIds],
        results: scenario.results.map((result) => ({
          ...result,
          url: result.url ? resolveFixtureUrl(result.url) : undefined
        }))
      }
    }
  ]
}

function FixtureSection({
  title,
  description,
  scenarioId,
  children
}: {
  title: string
  description: string
  scenarioId: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section
      className="overlay-chat-surface parity-fixture-section"
      data-parity-scenario={scenarioId}
    >
      <header className="parity-fixture-section__header">
        <h2>{title}</h2>
        <p>{description}</p>
        <code>{scenarioId}</code>
      </header>
      {children}
    </section>
  )
}

function PerfReadout({ config }: { config: FixtureConfig }): React.ReactElement {
  const [snapshot, setSnapshot] = useState<PerfDebugSnapshot>({ renders: {}, timings: {} })

  useEffect(() => {
    let cancelled = false
    const capture = async (): Promise<void> => {
      await waitForFixtureAssets()
      if (cancelled) return
      const perf = getPerfDebugSnapshot()
      setSnapshot(perf)
      window.__CHAT_PARITY_BASELINE__ = {
        fixtureVersion: CHAT_PARITY_FIXTURE_VERSION,
        platform: 'desktop',
        scenario: config.scenario,
        theme: config.theme,
        width: config.width,
        perf
      }
    }
    void capture()
    return () => {
      cancelled = true
    }
  }, [config])

  return (
    <details className="parity-fixture-perf">
      <summary>Render-count baseline</summary>
      <pre data-testid="render-counts">{JSON.stringify(snapshot, null, 2)}</pre>
    </details>
  )
}

function DesktopTextFixture({
  scenario,
  theme
}: {
  scenario: ChatParityTextScenario
  theme: ReturnType<typeof getPanelTheme>
}): React.ReactElement {
  const [messages, setMessages] = useState(() => textScenarioMessages(scenario))
  const [sourcesPanel, setSourcesPanel] = useState<{
    turnId: string
    sources: WebSourceItem[]
  } | null>(null)
  const selectResponseModel = useCallback((messageId: string, modelId: string) => {
    setMessages((previousMessages) =>
      previousMessages.map((message) => {
        if (message.id !== messageId) return message
        const selected = message.responses?.find((response) => response.modelId === modelId)
        return {
          ...message,
          selectedModelId: modelId,
          content: selected?.content || message.content,
          renderParts: selected?.renderParts || message.renderParts
        }
      })
    )
  }, [])

  const openSourcesPanel = useCallback((turnId: string, sources: WebSourceItem[]) => {
    setSourcesPanel((current) =>
      current?.turnId === turnId ? null : { turnId, sources }
    )
  }, [])

  return (
    <div className="flex min-h-80 min-w-0">
      <div className="min-w-0 flex-1">
        <DesktopChatTranscript
          messages={messages}
          models={[]}
          onDelete={() => undefined}
          onRetry={() => undefined}
          onReply={() => undefined}
          onBranch={() => undefined}
          onOpenSources={openSourcesPanel}
          sourcesPanel={sourcesPanel}
          onOpenAttachmentPreview={() => undefined}
          onSelectResponseModel={selectResponseModel}
          streamingAssistantMessageId={
            scenario.responseInProgress ? `${scenario.id}:assistant` : null
          }
          theme={theme}
        />
      </div>
      <DesktopSourcesPanel
        open={sourcesPanel !== null}
        onClose={() => setSourcesPanel(null)}
        sources={sourcesPanel?.sources ?? []}
        theme={theme}
      />
    </div>
  )
}

function DesktopMediaComposerFixture({
  theme
}: {
  theme: ReturnType<typeof getPanelTheme>
}): React.ReactElement {
  const controls = useDesktopMediaComposerState({
    imageModels: FIXTURE_IMAGE_MODELS,
    videoModels: FIXTURE_VIDEO_MODELS,
    defaultImageModelId: FIXTURE_IMAGE_MODELS[0].id,
    defaultVideoModelId: FIXTURE_VIDEO_MODELS[0].id,
    isFreeTier: false,
    persist: false
  })
  const [prompt, setPrompt] = useState('Create a calm launch visual.')
  const [messages, setMessages] = useState<Message[]>([])
  const canGenerate = canSubmitDesktopMediaDraft({
    generationMode: controls.generationMode,
    prompt,
    attachmentCount: 0,
    selectedImageModelIds: controls.selectedImageModelIds,
    selectedVideoModelIds: controls.selectedVideoModelIds,
    videoSubMode: controls.videoSubMode
  })

  const generatePreview = (): void => {
    if (!canGenerate || controls.generationMode === 'text') return
    const modelIds =
      controls.generationMode === 'image'
        ? controls.selectedImageModelIds
        : controls.selectedVideoModelIds
    const kind = controls.generationMode
    setMessages([
      {
        id: `composer-${kind}:user`,
        turnId: `composer-${kind}:turn`,
        role: 'user',
        content: prompt.trim(),
        timestamp: CHAT_PARITY_FIXTURE_TIMESTAMP,
        generation: {
          kind,
          modelIds,
          videoSubMode: kind === 'video' ? controls.videoSubMode : undefined,
          results: modelIds.map((modelId) => ({
            type: kind,
            status: 'completed',
            url: kind === 'image' ? CHAT_PARITY_IMAGE_DATA_URL : fixtureVideoUrl,
            modelUsed: modelId,
            outputId: `fixture-${kind}-${modelId}`
          }))
        }
      }
    ])
  }

  return (
    <div
      className="overlay-chat-surface shared-chat-scope space-y-5"
      data-testid="media-composer-fixture"
    >
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
        <label
          className="block text-xs font-medium text-[var(--muted)]"
          htmlFor="media-fixture-prompt"
        >
          Prompt
        </label>
        <input
          id="media-fixture-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--border)]"
        />
        <div className="mt-40 flex items-center justify-between gap-2">
          <DesktopMediaComposerControls
            generationMode={controls.generationMode}
            onGenerationModeChange={controls.setGenerationMode}
            imageModels={FIXTURE_IMAGE_MODELS}
            videoModels={FIXTURE_VIDEO_MODELS}
            selectedImageModelIds={controls.selectedImageModelIds}
            selectedVideoModelIds={controls.selectedVideoModelIds}
            imageModelSelectionMode={controls.imageModelSelectionMode}
            videoModelSelectionMode={controls.videoModelSelectionMode}
            onImageModelSelectionModeChange={controls.setImageModelSelectionMode}
            onVideoModelSelectionModeChange={controls.setVideoModelSelectionMode}
            onToggleImageModel={controls.toggleImageModel}
            onToggleVideoModel={controls.toggleVideoModel}
            videoSubMode={controls.videoSubMode}
            onVideoSubModeChange={controls.setVideoSubMode}
            isFreeTier={false}
          />
          <button
            type="button"
            onClick={generatePreview}
            disabled={!canGenerate}
            className="h-8 rounded-lg bg-[var(--foreground)] px-3 text-xs font-medium text-[var(--background)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Generate preview
          </button>
        </div>
      </div>
      {messages.length ? (
        <DesktopChatTranscript
          messages={messages}
          models={[]}
          onDelete={() => setMessages([])}
          onRetry={generatePreview}
          onReply={() => undefined}
          onBranch={() => undefined}
          onOpenSources={() => undefined}
          onOpenAttachmentPreview={() => undefined}
          onSelectResponseModel={() => undefined}
          theme={theme}
        />
      ) : null}
    </div>
  )
}

function EmbeddedConsumersFixture({
  theme
}: {
  theme: ReturnType<typeof getPanelTheme>
}): React.ReactElement {
  return (
    <div className="grid gap-5 lg:grid-cols-2" data-testid="embedded-consumers-fixture">
      <section className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
        <h3 className="mb-3 text-xs font-semibold text-[var(--foreground)]">Browser chat</h3>
        <EmbeddedChatTranscript
          idPrefix="fixture-browser"
          items={FIXTURE_BROWSER_ITEMS}
          isRunning={false}
          mode="act"
          theme={theme}
          modelId="fixture/browser-model"
          modelName="Browser model"
          planSteps={FIXTURE_BROWSER_PLAN}
          onContinue={() => undefined}
        />
      </section>
      <section className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
        <h3 className="mb-3 text-xs font-semibold text-[var(--foreground)]">Notebook chat</h3>
        <EmbeddedChatTranscript
          idPrefix="fixture-notebook"
          items={FIXTURE_NOTEBOOK_ITEMS}
          isRunning
          mode="act"
          theme={theme}
          modelId="fixture/notebook-model"
          modelName="Notebook model"
        />
      </section>
    </div>
  )
}

export function ChatParityFixtureWindow(): React.ReactElement {
  const config = useMemo(readFixtureConfig, [])
  const theme = useMemo(() => getPanelTheme(config.theme === 'dark'), [config.theme])
  const textScenarios = CHAT_PARITY_TEXT_SCENARIOS.filter(
    (scenario) => config.scenario === 'gallery' || config.scenario === scenario.id
  )
  const mediaScenarios = CHAT_PARITY_MEDIA_SCENARIOS.filter(
    (scenario) => config.scenario === 'gallery' || config.scenario === scenario.id
  )
  const knownScenario =
    config.scenario === 'gallery' ||
    config.scenario === 'media-composer' ||
    config.scenario === 'embedded-consumers' ||
    textScenarios.length > 0 ||
    mediaScenarios.length > 0

  useEffect(() => {
    document.documentElement.dataset.theme = config.theme
    document.documentElement.style.colorScheme = config.theme
    document.body.dataset.parityFixture = 'desktop'
    document.body.style.margin = '0'
    document.body.style.background = theme.panelBg
    return () => {
      delete document.documentElement.dataset.parityReady
      delete document.body.dataset.parityFixture
    }
  }, [config.theme, theme.panelBg])

  useEffect(() => {
    let cancelled = false
    const markReady = async (): Promise<void> => {
      await waitForFixtureAssets()
      if (!cancelled) document.documentElement.dataset.parityReady = 'true'
    }
    void markReady()
    return () => {
      cancelled = true
    }
  }, [config.scenario, config.theme, config.width])

  return (
    <main className="parity-fixture-page" style={{ background: theme.panelBg, color: theme.text }}>
      <div className="parity-fixture-content" style={{ maxWidth: config.width }}>
        <header className="parity-fixture-header">
          <div>
            <p className="parity-fixture-eyebrow">Electron parity harness</p>
            <h1>Desktop chat baseline</h1>
          </div>
          <div className="parity-fixture-meta">
            <div>{CHAT_PARITY_FIXTURE_VERSION}</div>
            <div>
              {config.theme} · {config.width}px · {config.scenario}
            </div>
          </div>
        </header>

        {!knownScenario ? (
          <div className="parity-fixture-unknown">Unknown fixture scenario: {config.scenario}</div>
        ) : null}

        {textScenarios.map((scenario) => (
          <FixtureSection
            key={scenario.id}
            title={scenario.title}
            description={scenario.description}
            scenarioId={scenario.id}
          >
            <DesktopTextFixture scenario={scenario} theme={theme} />
          </FixtureSection>
        ))}

        {mediaScenarios.map((scenario) => (
          <FixtureSection
            key={scenario.id}
            title={scenario.title}
            description={scenario.description}
            scenarioId={scenario.id}
          >
            <DesktopChatTranscript
              messages={mediaScenarioMessages(scenario)}
              models={[]}
              onDelete={() => undefined}
              onRetry={() => undefined}
              onReply={() => undefined}
              onBranch={() => undefined}
              onOpenSources={() => undefined}
              onOpenAttachmentPreview={() => undefined}
              onSelectResponseModel={() => undefined}
              streamingAssistantMessageId={
                scenario.results.some((result) => result.status === 'generating')
                  ? `${scenario.id}:assistant`
                  : null
              }
              theme={theme}
            />
          </FixtureSection>
        ))}

        {config.scenario === 'media-composer' ? (
          <FixtureSection
            title="Media composer cutover"
            description="Generation mode and model selection drive the shared media exchange."
            scenarioId="media-composer"
          >
            <DesktopMediaComposerFixture theme={theme} />
          </FixtureSection>
        ) : null}

        {config.scenario === 'embedded-consumers' ? (
          <FixtureSection
            title="Embedded chat consumers"
            description="Browser and notebook chats render through the canonical transcript path."
            scenarioId="embedded-consumers"
          >
            <EmbeddedConsumersFixture theme={theme} />
          </FixtureSection>
        ) : null}

        {config.perf ? <PerfReadout config={config} /> : null}
      </div>
    </main>
  )
}

resetPerfDebugSnapshot()
