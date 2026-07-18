"use client";

import { useEffect, useState } from "react";
import {
  CHAT_PARITY_FIXTURE_VERSION,
  CHAT_PARITY_MEDIA_SCENARIOS,
  CHAT_PARITY_TEXT_SCENARIOS,
  type ChatParityMediaScenario,
  type ChatParityTextScenario,
} from "@overlay/chat-core/parity-fixtures";
import {
  ChatExchange,
  DEFAULT_CHAT_TRANSCRIPT_PRESENTATION,
  getPerfDebugSnapshot,
  resetPerfDebugSnapshot,
  type PerfDebugSnapshot,
} from "@overlay/chat-react";
import type { UIMessage } from "@/shared/chat/ai-ui-message";
import { ChatMediaMessage } from "../components/ChatMediaMessage";

type ChatParityHarnessProps = {
  theme: "light" | "dark";
  scenario: string;
  width: 390 | 640 | 896;
  perf: boolean;
};

declare global {
  interface Window {
    __CHAT_PARITY_BASELINE__?: {
      fixtureVersion: string;
      platform: "web" | "desktop";
      scenario: string;
      theme: "light" | "dark";
      width: number;
      perf: PerfDebugSnapshot;
    };
  }
}

resetPerfDebugSnapshot();

function resolveMediaScenario(
  scenario: ChatParityMediaScenario,
): ChatParityMediaScenario {
  return {
    ...scenario,
    results: scenario.results.map((result) => ({ ...result })),
  };
}

function textScenarioVisible(
  selected: string,
  scenario: ChatParityTextScenario,
): boolean {
  return selected === "gallery" || selected === scenario.id;
}

function mediaScenarioVisible(
  selected: string,
  scenario: ChatParityMediaScenario,
): boolean {
  return selected === "gallery" || selected === scenario.id;
}

async function waitForFixtureAssets(): Promise<void> {
  await document.fonts?.ready;
  await Promise.all(
    Array.from(document.images).map(
      (element) =>
        new Promise<void>((resolve) => {
          if (element.complete) {
            resolve();
            return;
          }
          element.addEventListener("load", () => resolve(), { once: true });
          element.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  await Promise.all(
    Array.from(document.querySelectorAll("video")).map(
      (element) =>
        new Promise<void>((resolve) => {
          if (element.readyState >= HTMLMediaElement.HAVE_METADATA) {
            resolve();
            return;
          }
          element.addEventListener("loadedmetadata", () => resolve(), {
            once: true,
          });
          element.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function FixtureSection({
  title,
  description,
  scenarioId,
  children,
}: {
  title: string;
  description: string;
  scenarioId: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-parity-scenario={scenarioId}
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-4 shadow-sm sm:px-5"
    >
      <div className="mb-5 border-b border-[var(--border)] pb-3">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          {title}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          {description}
        </p>
        <code className="mt-2 inline-block text-[10px] text-[var(--muted-light)]">
          {scenarioId}
        </code>
      </div>
      {children}
    </section>
  );
}

function WebTextFixture({
  scenario,
  index,
}: {
  scenario: ChatParityTextScenario;
  index: number;
}) {
  const responseVariants = scenario.responseVariants?.length
    ? scenario.responseVariants
    : [
        {
          modelId: "openai/gpt-5.2",
          modelName: "GPT-5.2",
          assistantBlocks: scenario.assistantBlocks,
        },
      ];
  const [requestedSelectedTab, setSelectedTab] = useState(
    scenario.selectedResponseIndex ?? 0,
  );
  const selectedTab = Math.min(
    requestedSelectedTab,
    responseVariants.length - 1,
  );
  const selectedResponse = responseVariants[selectedTab]!;

  return (
    <ChatExchange
      userMsgId={`fixture-user-${scenario.id}`}
      userBodyText={scenario.userText}
      userDocumentNames={scenario.userDocuments}
      userIndexedAttachments={scenario.userDocuments.map((name) => ({
        name,
        fileIds: [`fixture-file-${scenario.id}`],
      }))}
      userImages={scenario.userImages}
      userMentions={scenario.userMentions}
      exchIdx={index}
      responseModelId={selectedResponse.modelId}
      assistantVisualBlocks={[...selectedResponse.assistantBlocks]}
      isStreaming={scenario.isStreaming}
      isTextStreaming={scenario.isTextStreaming}
      errorMessage={scenario.errorMessage}
      exchModelList={responseVariants.map((response) => response.modelId)}
      selectedTab={selectedTab}
      onTabSelect={setSelectedTab}
      isLoadingTabs={false}
      responseInProgress={scenario.responseInProgress}
      status={scenario.errorMessage
        ? 'error'
        : scenario.interrupted
          ? 'interrupted'
          : scenario.responseInProgress
            ? scenario.assistantBlocks.length > 0 ? 'streaming' : 'submitted'
            : 'completed'}
      turnIdForActions={`fixture-turn-${scenario.id}`}
      modelLabel={selectedResponse.modelName}
      onDeleteTurn={() => undefined}
      onReply={() => undefined}
      onBranch={() => undefined}
      interrupted={scenario.interrupted}
      actionsLocked={false}
      replyThreadMeta={scenario.replyThreadMeta}
      onJumpToReply={() => undefined}
      onOpenDraft={() => undefined}
      onCreateAutomationDraft={() => undefined}
      onOpenSources={() => undefined}
      isSourcesOpenForThis={false}
      onRetry={() => undefined}
      retryDisabled={false}
      onOpenFilePreview={() => undefined}
      onOpenAttachmentPreview={() => undefined}
      onContinue={scenario.interrupted ? () => undefined : undefined}
      getModelDisplayName={(modelId) =>
        responseVariants.find((response) => response.modelId === modelId)
          ?.modelName ?? modelId
      }
      generatedUiConnectorActions={{
        openEmailDraft: () => undefined,
        openExternalUrl: () => undefined,
      }}
      onGeneratedUiChange={() => undefined}
      presentation={DEFAULT_CHAT_TRANSCRIPT_PRESENTATION}
    />
  );
}

function WebMediaFixture({
  scenario,
  index,
}: {
  scenario: ChatParityMediaScenario;
  index: number;
}) {
  const resolved = resolveMediaScenario(scenario);
  const message = {
    id: `fixture-media-user-${scenario.id}`,
    role: "user",
    parts: [{ type: "text", text: scenario.prompt }],
  } satisfies UIMessage;

  return (
    <ChatMediaMessage
      message={message}
      exchangeIndex={index}
      kind={resolved.kind}
      generationResults={[...resolved.results]}
      exchangeModels={[...resolved.modelIds]}
      selectedImageModels={[]}
      selectedVideoModels={[]}
      exitingTurnIds={[]}
      onJumpToReply={() => undefined}
      onDeleteTurn={() => undefined}
      onReplyToMediaPrompt={() => undefined}
      onOpenAttachmentPreview={() => undefined}
    />
  );
}

function PerfReadout({
  theme,
  scenario,
  width,
}: Pick<ChatParityHarnessProps, "theme" | "scenario" | "width">) {
  const [snapshot, setSnapshot] = useState<PerfDebugSnapshot>({
    renders: {},
    timings: {},
  });

  useEffect(() => {
    let cancelled = false;
    const capture = async () => {
      await waitForFixtureAssets();
      if (cancelled) return;
      const perf = getPerfDebugSnapshot();
      setSnapshot(perf);
      window.__CHAT_PARITY_BASELINE__ = {
        fixtureVersion: CHAT_PARITY_FIXTURE_VERSION,
        platform: "web",
        scenario,
        theme,
        width,
        perf,
      };
    };
    void capture();
    return () => {
      cancelled = true;
    };
  }, [scenario, theme, width]);

  return (
    <details className="rounded-xl border border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted)]">
      <summary className="cursor-pointer font-medium">
        Render-count baseline
      </summary>
      <pre
        data-testid="render-counts"
        className="mt-3 overflow-x-auto whitespace-pre-wrap text-[10px] leading-relaxed"
      >
        {JSON.stringify(snapshot, null, 2)}
      </pre>
    </details>
  );
}

export function ChatParityHarness({
  theme,
  scenario,
  width,
  perf,
}: ChatParityHarnessProps) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.body.dataset.parityFixture = "web";
    return () => {
      delete document.documentElement.dataset.parityReady;
      delete document.body.dataset.parityFixture;
    };
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    const markReady = async () => {
      await waitForFixtureAssets();
      if (!cancelled) document.documentElement.dataset.parityReady = "true";
    };
    void markReady();
    return () => {
      cancelled = true;
    };
  }, [scenario, theme, width]);

  const textScenarios = CHAT_PARITY_TEXT_SCENARIOS.filter((item) =>
    textScenarioVisible(scenario, item),
  );
  const mediaScenarios = CHAT_PARITY_MEDIA_SCENARIOS.filter((item) =>
    mediaScenarioVisible(scenario, item),
  );
  const knownScenario =
    scenario === "gallery" ||
    textScenarios.length > 0 ||
    mediaScenarios.length > 0;

  return (
    <main className="overlay-chat-surface min-h-screen bg-[var(--background)] px-3 py-5 text-[var(--foreground)] sm:px-5">
      <div
        className="mx-auto flex w-full flex-col gap-5"
        style={{ maxWidth: width }}
      >
        <header className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-light)]">
              Web parity harness
            </p>
            <h1 className="mt-1 text-lg font-semibold">
              Desktop chat baseline
            </h1>
          </div>
          <div className="text-right text-[10px] leading-relaxed text-[var(--muted-light)]">
            <div>{CHAT_PARITY_FIXTURE_VERSION}</div>
            <div>
              {theme} · {width}px · {scenario}
            </div>
          </div>
        </header>

        {!knownScenario ? (
          <div className="rounded-xl border border-[var(--chat-alert-error-border)] bg-[var(--chat-alert-error-bg)] p-4 text-sm text-[var(--chat-alert-error-text)]">
            Unknown fixture scenario: {scenario}
          </div>
        ) : null}

        {textScenarios.map((item, index) => (
          <FixtureSection
            key={item.id}
            title={item.title}
            description={item.description}
            scenarioId={item.id}
          >
            <WebTextFixture scenario={item} index={index} />
          </FixtureSection>
        ))}

        {mediaScenarios.map((item, index) => (
          <FixtureSection
            key={item.id}
            title={item.title}
            description={item.description}
            scenarioId={item.id}
          >
            <WebMediaFixture
              scenario={item}
              index={textScenarios.length + index}
            />
          </FixtureSection>
        ))}

        {perf ? (
          <PerfReadout theme={theme} scenario={scenario} width={width} />
        ) : null}
      </div>
    </main>
  );
}
