<p align="center">
  <img src="./src/assets/overlay-logo.png" alt="Overlay" width="150">
</p>

<h1 align="left">Overlay</h1>

Overlay is an open-source workspace where humans and AI agents share context and get work done together. Keep knowledge in one place, delegate repeatable work to agents, review what they produce, and take action through connected tools.

<div align="center">

</div>

🔗 **[Try Overlay](https://getoverlay.io)**

## Why Overlay

Most AI products stop at a single answer. Overlay is built around the next step: a person and one or more agents working in the same context. A human can set direction, provide files and memory, ask an agent to research or execute a task, inspect the result, and decide what happens next.

The workspace is the shared layer between people and agents. Conversations, notes, files, projects, connected apps, and automations can be combined without moving work between separate tools. Overlay is designed to stay provider-neutral as models and agent runtimes change.

## Documentation

- [Developer & self-hosting docs](docs/introduction.mdx) — local setup, runtime config, deployment, API reference.
- [Quickstart](docs/start/quickstart.mdx) — get the web app running locally.
- [API Reference](docs/api-reference/overview.mdx) — generated from `src/shared/schemas/api-boundary.ts`.
- [Security policy](SECURITY.md) — reporting, launch controls, and secret handling.

Run `npm run docs:check` before publishing docs changes.

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
2. **Chat or Work** — Use Chat for conversation and synthesis; use Work when an agent needs to use tools, browse, or carry out a task.
3. **Review and continue** — Inspect sources, files, tool activity, and generated outputs, then keep working in the same shared context.

## Features

### Core Capabilities

- **Provider-neutral Chat** — Use the model providers enabled for your deployment from one workspace
- **Chat and Work modes** — Keep conversation and agent-led tool execution in the same thread
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
- **Vercel Sandbox** — Run code and CLI tasks in isolated, usage-metered sandboxes
- **Scheduled automations** — Interval, daily, weekly, or monthly recurring workflows
- **Skills** — Reusable instruction templates for common tasks
- **MCP servers** — Connect external tool servers via Model Context Protocol

#### Integrations (via Composio)
- Gmail, Google Calendar, Google Sheets, Google Drive
- Notion, Asana, Slack, GitHub
- LinkedIn, X (Twitter), Outlook
- And 100+ more apps

## Providers and model catalog

The model catalog is intentionally not duplicated in this README. Provider names, model IDs, capabilities, availability, and pricing change independently of the application. Use the in-product model selector and the gateway metadata as the source of truth for the deployment you are running.

Overlay keeps provider adapters behind a common gateway so the collaboration model remains stable while the available providers evolve.

## Built With

- [Next.js 15](https://nextjs.org/) — React framework with App Router
- [Tailwind CSS](https://tailwindcss.com/) — Styling
- [Vercel AI SDK](https://sdk.vercel.ai/docs) — AI streaming, tool calling, and multi-provider support
- [Convex](https://convex.dev/) — Backend functions, data, and realtime sync
- [WorkOS](https://workos.com/) — Enterprise authentication and SSO
- [Stripe](https://stripe.com/) — Billing and subscriptions
- [Composio](https://composio.dev/) — External app integrations
- [TipTap](https://tiptap.dev/) — Rich text editing
- [Vercel Sandbox](https://vercel.com/docs/sandbox) — Default managed code execution sandbox
- [Daytona](https://daytona.io/) — Optional alternative sandbox provider
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

- Node.js 22+
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

Convex deployments are environment-specific. Use `npm run convex:push:dev` only from the dedicated staging worktree. Use `npm run convex:push:prod` only from a clean canonical `main` worktree after its matching web deployment is live. Feature worktrees must not deploy Convex.

## Available Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Run the Next.js development server |
| `npm run build` | Create a production build |
| `npm run convex:push:prod` | Push Convex changes to production |
| `npm run convex:push:dev` | Push Convex changes to dev |

## Security

- Session cookies are encrypted and signed
- Transfer tokens are short-lived and hashed
- Provider keys isolated behind `PROVIDER_KEYS_SECRET`
- Sensitive logs redacted in chat and billing flows
- See `SECURITY.md` for full security guidance

## Project status

Overlay is under active development. The hosted product and the open-source repository may change as the collaboration model, provider integrations, and self-hosting support mature. Treat deployment, billing, and provider configuration as environment-specific and verify them before running a production instance.

## Contributing

- Do not commit real secrets or customer data
- Keep public docs on placeholders
- Treat `NEXT_PUBLIC_*` values as public
- Prefer backend logic in `convex/` with web handlers in `src/app/api/`
- Open issues and pull requests are welcome. LayerNorm requires the contributor terms in [`CLA.md`](CLA.md) before accepting an outside contribution.

## License

All first-party material stored directly in this repository is licensed under `AGPL-3.0-only`. Paid commercial licenses are available separately from LayerNorm Inc. Third-party material and separate submodules retain their own licenses.
- Overlay branding is governed by the trademark policy.

See [`LICENSE.md`](LICENSE.md), [`docs/legal/licensing.mdx`](docs/legal/licensing.mdx), and [`TRADEMARKS.md`](TRADEMARKS.md).

---

*Overlay — A shared workspace for humans and agents.*
