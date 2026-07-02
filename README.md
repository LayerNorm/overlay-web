<p align="center">
  <img src="./src/assets/overlay-logo.png" alt="Overlay" width="150">
</p>

<h1 align="left">Overlay</h1>

An AI workspace that thinks, remembers, creates, and acts — all in one place. Chat with top models, build persistent knowledge, generate media, and run automations without switching tabs.

<div align="center">

</div>
 

🔗 **[Try Overlay](https://getoverlay.io)**

## Powered By

<div align="center">

[![Vercel AI SDK](https://img.shields.io/badge/Vercel%20AI%20SDK-black?logo=vercel&logoColor=white)](https://sdk.vercel.ai/docs)
[![Convex](https://img.shields.io/badge/Convex-FCBD42?logo=convex&logoColor=black)](https://convex.dev)
[![WorkOS](https://img.shields.io/badge/WorkOS-6366F1?logo=workos&logoColor=white)](https://workos.com)
[![Stripe](https://img.shields.io/badge/Stripe-635BFF?logo=stripe&logoColor=white)](https://stripe.com)
[![Composio](https://img.shields.io/badge/Composio-FF6B6B?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggZD0iTTEyIDJhMTAgMTAgMCAxIDAgMTAgMTBBMTAgMTAgMCAwIDAgMTIgMloiLz48cGF0aCBkPSJNMTIgNmE2IDYgMCAxIDAgNiA2QTYgNiAwIDAgMCAxMiA2WiIvPjwvc3ZnPg==&logoColor=white)](https://composio.dev)

<br/>

| Service | Purpose |
|---------|---------|
| **Vercel AI SDK** | AI streaming, tool calling, multi-provider support |
| **Convex** | Backend functions, data, and realtime sync |
| **WorkOS** | Enterprise-grade authentication and SSO |
| **Stripe** | Billing and subscription management |
| **Composio** | 100+ external app integrations |

</div>

## How It Works

1. **Bring your context** — Upload files, save memories, create notes, and organize work into projects.
2. **Ask or Act** — Ask questions with full knowledge access, or switch to Act mode for tool use and automation.
3. **Create & execute** — Generate images and videos, run browser tasks, connect apps, and schedule automations.

## Features

### Core Capabilities

- **Multi-Model Chat** — Access top models from OpenAI, Anthropic, Google, xAI, Groq, and OpenRouter in one workspace
- **Ask & Act Modes** — Switch between answer synthesis (Ask) and tool execution (Act) depending on what you need
- **Persistent Memory** — Save preferences, facts, and standing instructions that compound over time
- **Knowledge Base** — Upload files, create folders, and search across your personal knowledge with semantic retrieval
- **Project Organization** — Group chats, notes, files, and context by project for focused work
- **Media Generation** — Create images and videos without leaving the workspace
- **Voice Input** — Record and transcribe audio directly into notes or chat
- **Browser Automation** — Run interactive browser tasks for live web work
- **External Integrations** — Connect Gmail, Calendar, Notion, GitHub, and 100+ apps via Composio
- **Automations** — Schedule recurring AI workflows that run on your behalf

### Workspace Areas

| Area | Description |
|---|---|
| **Chat** | Multi-model conversations with context from memories, files, and projects |
| **Notes** | Rich notebook editor with markdown, slash commands, and project linking |
| **Memories** | Durable facts and preferences that shape future responses |
| **Knowledge** | File storage with semantic search across documents and folders |
| **Projects** | Scoped workspaces for organizing related chats, notes, and files |
| **Outputs** | Gallery of generated images and videos with metadata and downloads |
| **Integrations** | Connected apps and tools for external actions |
| **Voice** | Audio recording and transcription flows |

### Tools & Actions

#### Knowledge & Memory
- **Memory CRUD** — Save, update, delete, and search personal memories
- **File search** — Lexical and semantic search across uploaded documents
- **Note management** — Create, edit, and organize notebook entries
- **Knowledge retrieval** — Hybrid semantic + keyword search across all saved context

#### Content Generation
- **Image generation** — GPT Image, Grok Image, FLUX, Seedream models with aspect ratio control
- **Video generation** — Veo 3.1, Seedance, Grok Video, Kling, Wan models
- **Image-to-video** — Animate static images into motion clips
- **Reference-to-video** — Place characters into new video scenes
- **Motion control** — Transfer motion from reference video to character images
- **Video editing** — Transform existing videos with text prompts

#### Automation & Execution
- **Browser sessions** — AI-controlled browser for interactive web tasks
- **Daytona sandbox** — Run code and CLI tasks in persistent sandboxes
- **Scheduled automations** — Interval, daily, weekly, or monthly recurring workflows
- **Skills** — Reusable instruction templates for common tasks
- **MCP servers** — Connect external tool servers via Model Context Protocol

#### Integrations (via Composio)
- Gmail, Google Calendar, Google Sheets, Google Drive
- Notion, Asana, Slack, GitHub
- LinkedIn, X (Twitter), Outlook
- And 100+ more apps

## Models Supported

### Chat Models

| Provider | Models |
|----------|--------|
| **OpenAI** | GPT-5.4, GPT-5.4 Mini, GPT-4.1 |
| **Anthropic** | Claude Opus 4.7, Claude Sonnet 4.6, Claude Haiku 4.5 |
| **Google** | Gemini 3.1 Pro, Gemini 3 Flash, Gemma 4 26B |
| **xAI** | Grok 4.20 |
| **DeepSeek** | DeepSeek V4 Pro, V4 Flash |
| **Moonshot** | Kimi K2.6, Kimi K2 Thinking (free) |
| **MiniMax** | MiniMax M2.7 |
| **Qwen** | Qwen 3.6 Plus |
| **GLM** | GLM 5.1 |
| **Groq** | GPT OSS 120B |
| **NVIDIA** | DeepSeek V3.2 (free), Kimi K2 Thinking (free) |
| **OpenRouter** | Free Router (auto-selects free models) |

### Image Models

- GPT Image 1.5, Grok Image Pro, Grok Image
- FLUX 2 Max, FLUX Schnell
- Seedream 5.0 Lite, Seedream 4.5

### Video Models

- Veo 3.1, Veo 3.1 Fast
- Seedance v1.5 Pro
- Grok Video
- Wan v2.6 (T2V, I2V, R2V)
- Kling v2.6 (T2V, I2V, Motion Control)

## Built With

- [Next.js 15](https://nextjs.org/) — React framework with App Router
- [Tailwind CSS](https://tailwindcss.com/) — Styling
- [Vercel AI SDK](https://sdk.vercel.ai/docs) — AI streaming, tool calling, and multi-provider support
- [Convex](https://convex.dev/) — Backend functions, data, and realtime sync
- [WorkOS](https://workos.com/) — Enterprise authentication and SSO
- [Stripe](https://stripe.com/) — Billing and subscriptions
- [Composio](https://composio.dev/) — External app integrations
- [TipTap](https://tiptap.dev/) — Rich text editing
- [Daytona](https://daytona.io/) — Code execution sandboxes
- [Browser Use](https://browser-use.com/) — Browser automation
- [OpenRouter](https://openrouter.ai/) — Unified model API
- [Shadcn/UI](https://ui.shadcn.com/) — UI components

## Repository Layout

```text
.
├── convex/                  # Backend schema, queries, mutations, actions, HTTP routes
├── src/app/                 # Next.js pages, layouts, and API route handlers
├── src/features/            # Web feature containers and feature-local helpers
├── src/components/          # Shared UI primitives, layout, and providers
├── src/server/              # Server-only auth, billing, storage, AI, and route services
├── src/shared/              # Isomorphic contracts and client-safe helpers
├── packages/                # Cross-surface packages and typed API clients
├── scripts/                 # Sanity scripts and one-off checks
├── docs/                    # Product, setup, testing, marketing, and implementation docs
├── AGENTS.md                # Local agent workspace notes
├── LICENSE.md               # License terms
└── SECURITY.md              # Security policy and reporting guidance
```

## Local Development

### Prerequisites

- Node.js 20+
- npm
- Convex account (dev + prod deployments)
- WorkOS credentials (for auth)
- Stripe test credentials (for billing)

### Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your credentials

# Run development server
npm run dev
```

For complete environment setup, see [`docs/start/quickstart.mdx`](docs/start/quickstart.mdx) and [`docs/configure/environment.mdx`](docs/configure/environment.mdx).

### Convex Workflow

Push backend changes to both environments:

```bash
npm run convex:push:all    # Push to both prod and dev
```

## Available Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Run the Next.js development server |
| `npm run build` | Create a production build |
| `npm run convex:push:prod` | Push Convex changes to production |
| `npm run convex:push:dev` | Push Convex changes to dev |
| `npm run convex:push:all` | Push Convex changes to both |

## Security

- Session cookies are encrypted and signed
- Transfer tokens are short-lived and hashed
- Provider keys isolated behind `PROVIDER_KEYS_SECRET`
- Sensitive logs redacted in chat and billing flows
- See `SECURITY.md` for full security guidance

## Contributing

- Do not commit real secrets or customer data
- Keep public docs on placeholders
- Treat `NEXT_PUBLIC_*` values as public
- Prefer backend logic in `convex/` with web handlers in `src/app/api/`

## License

Overlay uses a split license model:

- Core product surfaces are licensed under `AGPL-3.0-or-later`.
- Reusable SDKs, contracts, protocol packages, and shared UI packages are licensed under `Apache-2.0`.
- Overlay branding is governed by the trademark policy.

See [`LICENSE.md`](LICENSE.md), [`docs/legal/licensing.mdx`](docs/legal/licensing.mdx), and [`TRADEMARKS.md`](TRADEMARKS.md).

---

*Overlay — One workspace, many models, real memory, live action.*
