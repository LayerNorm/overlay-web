import type { AssistantVisualBlock, GenerationResult } from "./types";

export const CHAT_PARITY_FIXTURE_VERSION = "2026-07-17.3" as const;
export const CHAT_PARITY_FIXTURE_TIMESTAMP = 1_721_177_600_000;

const fixtureSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dbeafe"/>
      <stop offset="1" stop-color="#ddd6fe"/>
    </linearGradient>
  </defs>
  <rect width="960" height="640" fill="url(#sky)"/>
  <circle cx="760" cy="145" r="72" fill="#fef3c7"/>
  <path d="M0 510 210 300l145 145 115-105 255 245H0Z" fill="#94a3b8"/>
  <path d="M180 585 455 275l330 310H180Z" fill="#475569"/>
  <path d="m383 356 72-81 82 77-48-19-34 32-32-28Z" fill="#f8fafc"/>
  <text x="44" y="70" font-family="system-ui, sans-serif" font-size="30" fill="#1e293b">Overlay parity fixture</text>
</svg>`;

export const CHAT_PARITY_IMAGE_DATA_URL =
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fixtureSvg.trim())}` as const;
export const CHAT_PARITY_VIDEO_URL =
  "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAARTbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAA350cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAEAAABAAAAAAL2bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAMABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACoW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAmFzdGJsAAAAwXN0c2QAAAAAAAAAAQAAALFhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAN2F2Y0MBZAAe/+EAGmdkAB6s2UCgL/lwEQAAAwABAAADADAPFi2WAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAACdoAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAYAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAyGN0dHMAAAAAAAAAFwAAAAEAAAQAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAgAAAAAAgAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAABgAAAABAAAAdHN0c3oAAAAAAAAAAAAAABgAAAMUAAAAFgAAABIAAAASAAAAEgAAABwAAAAUAAAAEgAAABIAAAAcAAAAFAAAABIAAAASAAAAGwAAABQAAAASAAAAEgAAABoAAAAUAAAAEgAAABIAAAAaAAAAFAAAABIAAAAUc3RjbwAAAAAAAAABAAAEgwAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjEuNy4xMDAAAAAIZnJlZQAABPVtZGF0AAACrwYF//+r3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOCAzMWUxOWY5IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTExIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yNCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAF1liIQAO//+46v4FJt0HQTyOPqRNGNPzxSXbPITNxyv/gd9NWAAAAMAAAMAABSzhc91exmPY8AAAAdMAVIHoEPDDC5DVDwFDHWKcQAgQAAAAwAAAwAAAwAAAwAALeEAAAASQZokbEO//qmWAAADAAADAOWAAAAADkGeQniF/wAAAwAAAwEPAAAADgGeYXRCvwAAAwAAAwF3AAAADgGeY2pCvwAAAwAAAwF3AAAAGEGaaEmoQWiZTAh3//6plgAAAwAAAwDlgQAAABBBnoZFESwv/wAAAwAAAwEPAAAADgGepXRCvwAAAwAAAwF3AAAADgGep2pCvwAAAwAAAwF3AAAAGEGarEmoQWyZTAh3//6plgAAAwAAAwDlgAAAABBBnspFFSwv/wAAAwAAAwEPAAAADgGe6XRCvwAAAwAAAwF3AAAADgGe62pCvwAAAwAAAwF3AAAAF0Ga8EmoQWyZTAhv//6nhAAAAwAAAwHHAAAAEEGfDkUVLC//AAADAAADAQ8AAAAOAZ8tdEK/AAADAAADAXcAAAAOAZ8vakK/AAADAAADAXcAAAAWQZs0SahBbJlMCGf//p4QAAADAAAG9AAAABBBn1JFFSwv/wAAAwAAAwEPAAAADgGfcXRCvwAAAwAAAwF3AAAADgGfc2pCvwAAAwAAAwF3AAAAFkGbd0moQWyZTAhX//44QAAAAwAAGzEAAAAQQZ+VRRUsK/8AAAMAAAMBdwAAAA4Bn7ZqQr8AAAMAAAMBdw==" as const;

export type ChatParityTextScenario = {
  id: string;
  title: string;
  description: string;
  userText: string;
  userDocuments: string[];
  userImages: Array<{ url: string; name: string; mediaType: string }>;
  userMentions: Array<{ type: string; id: string; name: string }>;
  replyThreadMeta: { replyToTurnId: string; replySnippet: string } | null;
  assistantBlocks: AssistantVisualBlock[];
  responseVariants?: Array<{
    modelId: string;
    modelName: string;
    assistantBlocks: AssistantVisualBlock[];
  }>;
  selectedResponseIndex?: number;
  isStreaming: boolean;
  isTextStreaming: boolean;
  responseInProgress: boolean;
  errorMessage: string | null;
  interrupted: boolean;
};

export type ChatParityMediaScenario = {
  id: string;
  title: string;
  description: string;
  kind: "image" | "video";
  prompt: string;
  modelIds: string[];
  results: GenerationResult[];
};

const richMarkdown = `# Release readiness

This fixture checks **bold**, _italic_, ~~strikethrough~~, [links](https://example.com), and inline \`code\`.

> Parity means the same content contract produces the same visual hierarchy.

## Checklist

- [x] Deterministic content
- [ ] Desktop and web comparison
  - Nested spacing remains visible

1. Render the fixture
2. Capture the baseline
3. Compare the surfaces

| Surface | Status | Notes |
| --- | ---: | --- |
| Web | Baseline | Reference renderer |
| Desktop | Baseline | Current behavior |

\`\`\`ts
const parity = fixtures.map(({ id }) => id)
console.log(parity.join(', '))
\`\`\`

The inline equation is $E = mc^2$ and the display equation is:

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$`;

export const CHAT_PARITY_TEXT_SCENARIOS: readonly ChatParityTextScenario[] = [
  {
    id: "rich-markdown",
    title: "Rich Markdown and attachments",
    description:
      "Typography, nested spacing, tables, code, math, mentions, reply context, and attachments.",
    userText: "Summarize the release checklist and keep the formatting intact.",
    userDocuments: ["release-readiness.pdf"],
    userImages: [
      {
        url: CHAT_PARITY_IMAGE_DATA_URL,
        name: "mountain-reference.svg",
        mediaType: "image/svg+xml",
      },
    ],
    userMentions: [
      { type: "file", id: "fixture-file-1", name: "Release notes" },
    ],
    replyThreadMeta: {
      replyToTurnId: "fixture-earlier-turn",
      replySnippet:
        "Please include the table and the final verification equation.",
    },
    assistantBlocks: [{ kind: "text", text: richMarkdown }],
    isStreaming: false,
    isTextStreaming: false,
    responseInProgress: false,
    errorMessage: null,
    interrupted: false,
  },
  {
    id: "multi-model-text",
    title: "Multi-model text responses",
    description:
      "Response tabs stay inside their exchange and switch the selected assistant presentation.",
    userText: "Compare the two rollout recommendations.",
    userDocuments: [],
    userImages: [],
    userMentions: [],
    replyThreadMeta: null,
    assistantBlocks: [
      {
        kind: "text",
        text: "## Beta recommendation\n\nShip to the internal cohort first, then expand after the parity checks pass.",
      },
    ],
    responseVariants: [
      {
        modelId: "openai/gpt-5.2",
        modelName: "GPT-5.2",
        assistantBlocks: [
          {
            kind: "text",
            text: "## Alpha recommendation\n\nShip broadly after one final smoke test.",
          },
        ],
      },
      {
        modelId: "anthropic/claude-sonnet-4.5",
        modelName: "Claude Sonnet 4.5",
        assistantBlocks: [
          {
            kind: "text",
            text: "## Beta recommendation\n\nShip to the internal cohort first, then expand after the parity checks pass.",
          },
        ],
      },
    ],
    selectedResponseIndex: 1,
    isStreaming: false,
    isTextStreaming: false,
    responseInProgress: false,
    errorMessage: null,
    interrupted: false,
  },
  {
    id: "reasoning-tools",
    title: "Reasoning, tools, and generated UI",
    description:
      "Sequential reasoning, completed tool calls, browser/search presentation, and a generated draft.",
    userText:
      "Research the launch checklist, inspect the source, then draft a short update.",
    userDocuments: [],
    userImages: [],
    userMentions: [],
    replyThreadMeta: null,
    assistantBlocks: [
      {
        kind: "reasoning",
        key: "fixture-reasoning",
        text: "I will verify the source, compare the requirements, and draft the smallest useful update.",
        state: "done",
      },
      {
        kind: "tool",
        key: "fixture-search",
        name: "perplexity_search",
        state: "output-available",
        toolInput: { query: "Overlay desktop parity release checklist" },
        toolOutput: {
          results: [
            {
              title: "Parity fixture specification",
              url: "https://example.com/parity-fixture",
              snippet:
                "Deterministic fixtures make visual regressions comparable.",
            },
          ],
        },
      },
      {
        kind: "tool",
        key: "fixture-read",
        name: "read_file",
        state: "output-available",
        toolInput: { path: "plans/desktop-web-chat-parity.md" },
        toolOutput: { success: true, lines: 42 },
      },
      {
        kind: "text",
        text: "The baseline is ready to review. The fixtures are isolated from live chat data and production startup behavior.",
      },
      {
        kind: "generated-ui",
        part: {
          type: "data",
          id: "fixture-generated-draft",
          dataType: "overlay.generated_ui",
          data: {
            version: 1,
            kind: "draft.email",
            subject: "Desktop chat parity baseline",
            body: "The deterministic web and desktop fixture harnesses are ready for comparison.",
            to: ["team@example.com"],
          },
        },
      },
    ],
    isStreaming: false,
    isTextStreaming: false,
    responseInProgress: false,
    errorMessage: null,
    interrupted: false,
  },
  {
    id: "loading",
    title: "Submitted loading state",
    description: "A submitted turn before the first assistant content arrives.",
    userText: "What should we verify before merging?",
    userDocuments: [],
    userImages: [],
    userMentions: [],
    replyThreadMeta: null,
    assistantBlocks: [],
    isStreaming: true,
    isTextStreaming: false,
    responseInProgress: true,
    errorMessage: null,
    interrupted: false,
  },
  {
    id: "streaming",
    title: "Streaming Markdown",
    description: "Partially streamed Markdown with an active text indicator.",
    userText: "Stream a concise rollout plan.",
    userDocuments: [],
    userImages: [],
    userMentions: [],
    replyThreadMeta: null,
    assistantBlocks: [
      {
        kind: "text",
        text: "## Rollout\n\n1. Capture the baseline.\n2. Compare both surfaces.\n3. Fix the first shared primitive",
      },
    ],
    isStreaming: true,
    isTextStreaming: true,
    responseInProgress: true,
    errorMessage: null,
    interrupted: false,
  },
  {
    id: "error-interrupted",
    title: "Error and interruption",
    description:
      "A partial answer followed by the shared interrupted and error treatment.",
    userText: "Generate the final report.",
    userDocuments: [],
    userImages: [],
    userMentions: [],
    replyThreadMeta: null,
    assistantBlocks: [
      {
        kind: "text",
        text: "I completed the visual audit, but the final export did not finish.",
      },
    ],
    isStreaming: false,
    isTextStreaming: false,
    responseInProgress: false,
    errorMessage: "Fixture transport failed after the partial response.",
    interrupted: true,
  },
] as const;

export const CHAT_PARITY_MEDIA_SCENARIOS: readonly ChatParityMediaScenario[] = [
  {
    id: "image-complete",
    title: "Completed image",
    description: "A completed image generation result.",
    kind: "image",
    prompt: "Create a calm geometric mountain landscape.",
    modelIds: ["google/imagen-4.0-generate-001"],
    results: [
      {
        type: "image",
        status: "completed",
        url: CHAT_PARITY_IMAGE_DATA_URL,
        modelUsed: "google/imagen-4.0-generate-001",
        outputId: "fixture-image-output",
      },
    ],
  },
  {
    id: "image-generating",
    title: "Multi-model image loading",
    description: "Two deterministic image generation placeholders.",
    kind: "image",
    prompt: "Generate two visual directions for the desktop launch.",
    modelIds: ["google/imagen-4.0-generate-001", "openai/gpt-image-1"],
    results: [
      { type: "image", status: "generating" },
      { type: "image", status: "generating" },
    ],
  },
  {
    id: "video-complete",
    title: "Completed video",
    description:
      "A completed video result backed by a local deterministic asset.",
    kind: "video",
    prompt: "Animate a subtle gradient moving from left to right.",
    modelIds: ["google/veo-3.1-generate-preview"],
    results: [
      {
        type: "video",
        status: "completed",
        url: CHAT_PARITY_VIDEO_URL,
        modelUsed: "google/veo-3.1-generate-preview",
        outputId: "fixture-video-output",
      },
    ],
  },
  {
    id: "video-failed",
    title: "Failed video",
    description: "A stable failed-generation presentation.",
    kind: "video",
    prompt: "Render a cinematic desktop transition.",
    modelIds: ["google/veo-3.1-generate-preview"],
    results: [
      {
        type: "video",
        status: "failed",
        error: "Fixture generation failed before an output was created.",
      },
    ],
  },
] as const;

export function getChatParityScenarioIds(): string[] {
  return [
    ...CHAT_PARITY_TEXT_SCENARIOS.map((scenario) => scenario.id),
    ...CHAT_PARITY_MEDIA_SCENARIOS.map((scenario) => scenario.id),
  ];
}
