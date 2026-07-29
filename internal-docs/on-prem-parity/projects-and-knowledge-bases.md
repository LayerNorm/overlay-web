# Projects And Knowledge Bases — Implementation Plan

> **Projects are where you work. Knowledge bases are what you trust.**

Status legend: DONE · PARTIAL · TODO · DEFERRED (deliberately out of scope for now)

- **Branch:** `codex/authorization-system` (also pushed to `staging`)
- **Last updated:** Phase 8
- **App-data schema version:** 26

---

## Status At A Glance

| Phase | Scope | Status |
|---|---|---|
| 0 | Lock the product contracts | **DONE** |
| 1 | Knowledge Base core | **DONE** |
| 2 | Project core | **DONE** |
| 3 | Connect projects and knowledge (one KB) | **DONE** |
| 4 | Rich knowledge retrieval | **DONE** |
| 5 | Mature project workflows | **DONE** — sharing remains in Phase 7 |
| 6 | Personal brain | **DONE** |
| 7 | Sharing and access | **DONE** |
| 8 | Admin distribution | **DONE** |
| 9 | Custom authorization and policies | PARTIAL — authz done, governance not |

### Note on execution order

Phases 7–9 were built **before** Phases 1–4, not after as this plan recommends.
The authorization kernel (custom roles, capabilities, groups, resource ACLs,
audit) shipped first because shared knowledge bases could not be built safely
without it. That inversion is why several later phases read as PARTIAL: their
authorization foundation exists while their product surface does not.

---

## Product Rule

- **Projects are where work happens:** chats, working files, instructions, outputs, and eventually tools.
- **Knowledge bases are what the user trusts:** curated sources, retrieval, citations, and reuse across multiple chats or projects.
- A project may attach knowledge bases, but a knowledge base must remain independently reusable.
- Knowledge bases should not acquire project features such as chats, instructions, automations, or skills.

---

## Phase 0: Lock The Product Contracts — DONE

### Knowledge Base

- DONE Contains sources.
- DONE Supports hybrid semantic and keyword retrieval.
- DONE Returns citations.
- DONE Can be invoked with `@Knowledge Base`.
- DONE Has no embedded chat workspace — the KB chat tab was removed.
- DONE Has no behavioral instructions.

### Project

- DONE Contains chats and working files.
- DONE Has standing instructions.
- DONE Provides a focused chat experience.
- DONE May attach knowledge bases.
- DONE Project files are working context, not automatically durable organizational knowledge.

### Shared UX

- DONE Standard page-header height and divider.
- DONE Shared segmented-control primitive at `packages/overlay-ui/src/components/primitives/SegmentedControl.tsx`, used by Chat, Files, Admin, Knowledge, and Projects.
- DONE Consistent Chat / Files / Settings navigation.
- DONE Sources open in a docked right sidebar.

**Gate:** met. Delivered in `bf8a25c7b`.

---

## Phase 1: Knowledge Base Core — DONE

### Functionality

- DONE Create, list, open, rename, describe, and delete a knowledge base.
- DONE Upload files and paste text as sources.
- DONE Source lifecycle: pending, extracting, indexing, ready, failed, deleting.
- DONE Retry failed ingestion.
- DONE Enable, disable, and remove sources.
- DONE Search within a knowledge base using hybrid retrieval.
- DONE Result snippets, source names, and processing status.
- DONE Knowledge Base chat tab and embedded conversations removed.
- DONE Both knowledge headers aligned with the main application header.
- DONE Knowledge category in the global `@` menu, capability-gated on `knowledge.read`.
- DONE Users can attach one or more KB mentions to a chat request.
- DONE Cited sources display in a docked right sidebar.

### Basic Knowledge QA

| # | Check | Status |
|---|---|---|
| 1 | Two KBs with clearly different content | DONE — automated, fixed corpus over two bases |
| 2 | Upload PDF, text, Office documents | PARTIAL — text/paste automated; PDF and Office manual only |
| 3 | Processing states update without refresh | PARTIAL — manual |
| 4 | Exact phrases and semantic paraphrases | DONE — keyword, semantic, and mixed query set |
| 5 | Disabled and deleted sources not retrievable | DONE — automated |
| 6 | Retry a deliberately failed source | DONE — automated |
| 7 | Mention a KB from global chat | DONE — body-builder and turn-context tests |
| 8 | Only the mentioned KB supplies results | DONE — mention narrows scope |
| 9 | Citations open the correct source | PARTIAL — offsets and highlights automated; click-through manual |
| 10 | Empty, loading, error, mobile, light, dark states | TODO — manual, not done |
| 11 | Refresh persistence | PARTIAL — manual |
| 12 | Same repository contracts on Convex and Postgres | DONE — 6/6 on both |

**Exit gate:** met for functionality. Visual-state QA (#10) is the remaining gap.

---

## Phase 2: Project Core — DONE

### Project Layout

- DONE Three modes: **Chat**, **Files**, **Settings**.

### Chat

- DONE Renders the real Overlay chat experience inside the project.
- DONE Shows project conversation history.
- DONE Model selection, modes, temporary chat, stop generation, sources.
- DONE Project instructions and working context applied automatically.
- DONE No separate reduced project-chat implementation — the real chat runtime is reused.

### Files

- DONE Project-scoped Files experience.
- DONE Upload, preview, rename, organize, download, delete working files.
- DONE File mentions in project chats.
- DONE Project files are not auto-promoted into knowledge bases.

### Settings

- DONE Project name and description.
- DONE Persistent project instructions.
- DONE Archive, restore, delete.
- DONE Sharing and role management deliberately excluded from this phase.

### Basic Project QA

| # | Check | Status |
|---|---|---|
| 1 | Create, rename, archive, restore, delete | DONE |
| 2 | Instructions affect new chats | DONE |
| 3 | Instructions persist across refresh | DONE |
| 4 | Multiple project chats, switching | DONE |
| 5 | Files usable in project chat | DONE |
| 6 | Project files do not leak across projects | DONE |
| 7 | Archived projects do not receive new work | DONE |
| 8 | Streaming, stop, refresh recovery, titles | PARTIAL — partly manual |
| 9 | Convex and Postgres | DONE — both |
| 10 | No provider-specific client when backend disabled | DONE — `no-convex-runtime` test |

**Exit gate:** met.

**Bugs found and fixed during this phase.** Convex stored canonical notes as
`files(kind='note')` while the authorization owner resolver only looked at the
legacy `notes` table, so an owner was denied access to their own note. The client
also overwrote the project list with an active-only bootstrap on RSC prop
refresh, hiding archived projects.

---

## Phase 3: Connect Projects And Knowledge — DONE

- DONE A project can attach one knowledge base.
- DONE The selection lives in Project Settings.
- DONE The attached KB is available automatically in project chat.
- DONE Project files remain separate working context.
- DONE Instructions control behavior; the KB supplies facts.
- DONE The project header indicates the active KB.
- DONE Deleting the KB detaches safely without deleting the project.

### Comparative Distinction QA

- DONE Verified end to end in a browser. With the KB attached, a project
  instruction marker applied and the KB supplied a cited private fact. Detached,
  the instruction still applied but the KB fact became unavailable. Reattached,
  grounded retrieval returned.
- DONE Attaching the same KB to another project transfers no chats, files, or instructions.
- DONE Global chat can still invoke the KB independently.

**Exit gate:** met. This was the critical milestone.

---

# Advanced Product Development

## Phase 4: Rich Knowledge Retrieval — DONE

| Item | Status | Notes |
|---|---|---|
| Attach multiple KBs to a project or chat | DONE | schema 23: `project_knowledge_bases`; conversation primary key widened |
| Explicit hard retrieval boundaries | DONE | every base re-authorized at retrieval time; only enabled memberships on `ready` sources |
| Search inside one KB or across selected KBs | DONE | the path base always leads; `additionalKnowledgeBaseIds` opts into cross-base |
| Better result ranking and deduplication | DONE | round-robin fusion across bases; normalized-text dedup |
| Citation passage highlighting | DONE | character spans, quoted phrases, whole-word matching |
| Indexing diagnostics and extraction previews | DONE | `GET /api/v1/knowledge-bases/{id}/diagnostics` |
| Reindexing and embedding-model migrations | DONE | `/reindex` route plus `knowledge:embedding-drift` and `knowledge:embedding-migrate` |
| Source provenance and freshness metadata | DONE | provenance in source metadata; freshness derived, never stored |
| Website sources | DONE | `UrlKnowledgeSourceFetcher` with SSRF protection |
| Connector and cloud-drive sources | PARTIAL | kinds and registry exist; fetchers return 501 until implemented |
| Image, audio, and video ingestion | DEFERRED | explicitly deferred by this plan |
| Retrieval operations UI | DONE | website capture, extraction preview, per-source diagnostics, refresh, retry, and stale/source reindex controls |

### Retrieval scope rule

An explicit `@Knowledge` mention **narrows** the turn to only the mentioned
base or bases, overriding the project's attached set. Project instructions are
unaffected by narrowing. Modes: `project`, `selected`, `combined`.

### QA

| Check | Status |
|---|---|
| Fixed retrieval corpus with expected answers | DONE — 5 sources across 2 bases |
| Keyword, semantic, and mixed queries | DONE |
| Citation precision and source coverage metrics | DONE — coverage gated at 1.00; precision@1 reported |
| Cross-KB isolation | DONE |
| Deleted-source and stale-index tests | DONE |
| Large-corpus latency and pgvector plan checks | DONE — HNSW index scan confirmed at 900 chunks |

**Two metrics were unsound on first writing and were corrected.**

1. Precision over the whole result set is meaningless when 5 hits are requested
   from a 4-source corpus, because it returns everything regardless of ranking
   quality. Coverage is now the hard gate and is always 1.00; precision@1 is
   reported with a loose floor.
2. pgvector HNSW is an **approximate** index. Both which passage ranks first and
   whether the planner chooses the index vary between runs. Index use is
   therefore asserted at 900 chunks where it must win, and merely reported at
   small scale where a filtered exact sort is legitimately better. Verified
   stable across three consecutive runs.

### Known backend asymmetry

Convex stores embeddings without provider/model identity, so embedding-drift
detection is a Postgres-only capability. This is explicit in the repository
contract via an optional `diagnostics` port rather than a silent degradation.

### Post-release defect: the boundary did not cover agent tools

Found by the first real user test, after every automated gate above was green.

A knowledge base named "Notes" holding five IGCSE Biology PDFs was asked "take me
through what is in @Notes". The answer listed eleven unrelated in-app notes and
four company documents that were not in the base, while omitting three of the
five that were.

The hard boundary built in this phase guarded only the **passive retrieval
injection**. The agent's **tools** were never scoped:

- `search_knowledge` has no `knowledgeBaseId` parameter. It calls
  `/api/v1/knowledge/search` account-wide over every file and memory the user owns.
- Its description told the model to "call this when you need facts from their
  knowledge base", steering it directly at the unscoped tool.
- `list_notes` and `search_in_files` are likewise account-wide.
- "What is in X" is a manifest question, not a content question. No tool could
  answer it, and the mention context supplied only the base's title and
  description, so the model invented a mapping from "Notes" to the in-app notes.

Fixed in `b20e8be3c` with **preferred** scoping: general tools stay available for
explicitly different asks, but stop misdirecting.

| Addition | Purpose |
|---|---|
| `list_knowledge_bases` | Resolve a referenced name to an id |
| `list_knowledge_base_sources` | The missing manifest affordance; authoritative contents |
| `search_knowledge_base` | Hybrid retrieval restricted to one base, with citations |
| `read_knowledge_source` | Extracted text for walkthroughs, where snippets are the wrong shape |

Plus: `search_knowledge` now describes itself as account-wide and names the active
base; mention context injects the full source manifest; corpus-wide questions
select breadth-first across sources.

**Lesson that should shape later phases.** Every Phase 4 test exercised
`KnowledgeBaseRetrievalService`. The leak was on a path no test touched. Any
feature that scopes capability to a container must be tested through **what the
agent can reach**, not only what a repository returns. Tool *descriptions* are
part of that contract and need review like code. This applies directly to Phase 5,
which scopes models, tools, skills, MCP servers, connectors, and automations to a
project — the same class of problem.

**Exit gate:** implementation met. Awaiting user confirmation that the `@Notes`
walkthrough is now correct in the running app.

---

## Phase 5: Mature Project Workflows — DONE

| Item | Status |
|---|---|
| Attach multiple KBs | **DONE** — delivered by Phase 4 |
| Project-specific model and tool selection | **DONE** — preferred model applies when a request does not explicitly choose one; native tool policy narrows the final agent surface |
| Skills, MCP servers, connectors, and automations | **DONE** — each runtime reads the project allowlist; an explicit empty list disables the resource |
| Durable generated outputs | **DONE** — generated image/video files retain `projectId` and appear with project working files |
| Promote a project file into a KB | **DONE** — explicit command, snapshot with provenance |
| Copy a KB source into a project as working material | **DONE** — editable note that names its origin |
| Templates for repeatable projects | **DONE** — projects flagged `isTemplate` |
| Project export and duplication | **DONE** — configuration-only duplication; portable JSON export strips object-store keys and credentials |
| Collaboration and basic project sharing | **DONE** — owner-managed user/group/role ACLs in Phase 7 |

### Configuration model (schema 25)

`projects.settings` is one JSON blob on both backends carrying `preferredModelId`,
a tool policy, enabled skill/MCP/connector ids, an automations switch, and
template status. Absent or malformed settings read as "inherit the account
default", so pre-25 projects keep working and a hand-edited row cannot widen
access.

Two semantics worth remembering:

- An allowlist with **no entries** means "no optional tools", not "all tools".
  The opposite reading is the dangerous default.
- `enabledSkillIds` and friends distinguish `undefined` (inherit everything) from
  an explicit `[]` (allow none).

### Enforcement, carrying the Phase 4 lesson

`applyProjectToolPolicy` runs at the **tool layer**, last in the gate chain, and
only ever narrows — a project can never reintroduce a tool the account or
deployment already withheld. Skills are filtered before prompt construction,
MCP servers before lazy-tool registration, connector meta-tools at execution,
and project automations at create/resume/manual-run boundaries. This placement
is the direct response to the Phase 4 defect, where a boundary that existed only
on the retrieval path let the agent reach around it.

### Transfers are explicit and directional

- **Promotion** copies a project file's text into a knowledge base *by value*, so
  editing the file afterwards cannot silently rewrite what the base asserts.
  Provenance records the originating project and artifact.
- **Copying back** produces an editable working note that names its origin and
  states that it does not stay in sync.
- A file with no extracted text returns 409 rather than promoting an empty source.

### Duplication

Copies configuration only. No chats, files, notes, or outputs, because a duplicate
is a fresh workspace. Attachments are re-attached through `KnowledgeBaseService`,
so each is re-authorized against the copying user rather than trusted from the
source project.

### QA

| Check | Status |
|---|---|
| Tool access remains project-scoped | **DONE** — verified through the agent tool surface |
| Skill, MCP, connector, and automation policy | **DONE** — fail-closed tests cover explicit-empty and disallowed execution |
| Promotions and copies preserve provenance | **DONE** |
| Duplicated projects do not accidentally share private working data | **DONE** — asserts absence, not just presence |
| Archived projects stop background work | **DONE** — archived projects contribute no runtime context and enabled automations are paused |
| Multi-tab and multi-user collaboration behavior | TODO |
| Worker recovery and idempotency for long-running actions | TODO |

### Product surface status

Project settings now expose model, native-tool, skill, MCP, connector, automation,
template, transfer, duplication, export, and lifecycle controls. The export is
deliberately a JSON workspace manifest: it includes project conversations,
messages, notes, text and file metadata, but never storage keys, provider
credentials, or pre-signed URLs.

### Deliberate deferral

**Collaboration and project sharing** is implemented by Phase 7 through the same
resource-ACL model used by knowledge bases. It is surfaced in Project Settings
rather than duplicated in the project configuration blob.

---

## Phase 6: Personal Brain — DONE

| Item | Status |
|---|---|
| Every user can maintain personal knowledge bases | **DONE** — `kind: 'personal'` is the default |
| Personal KBs available through `@` mentions | **DONE** |
| Deliberately promote project learnings into a personal brain | **DONE** — P5b promotion targets any base the user can edit |
| Do **not** automatically index all chats and files | **DONE** — upheld; nothing is captured as a side effect |
| Explicit capture actions | **DONE** — add source, save answer as knowledge, promote project file; extract memory already existed |
| Separate conversational memory from curated knowledge | **DONE** — memory is excluded when a KB scope is active |
| Personal-brain product surface | **DONE** — first-class My knowledge card plus assistant-response capture action |

### Capture is always deliberate

`saveAnswerAsKnowledge` captures a chat answer only when someone asks for it.
Chats never enter a base on their own, which is what keeps a base curated rather
than a running log of everything the user touched.

### A defect this phase surfaced in Phase 5's promotion path

`knowledge_sources` carries a unique index on `(owner_user_id, kind, source_ref)`
for non-deleted rows. P5b set `sourceRef` to the bare file id, so:

- promoting the same file **twice** would violate the index and surface as a
  database error rather than updating, and
- promoting one file into **two different bases** would collide as well.

Fixed by namespacing the ref as `promotion:{knowledgeBaseId}:{artifactId}` and
looking for an existing capture first, which turns a re-promotion into a new
**version** of the same source. That matches the product intent recorded in
Phase 3: a promotion is a snapshot, and the user may explicitly publish a newer
one later. Verified by reverting the fix and observing the failure.

### Personal bases

`ensureDefaultPersonalKnowledgeBase` creates "My knowledge" on first explicit
request and is idempotent afterwards. `listPersonalKnowledgeBases` returns the
owned personal subset only — bases shared *with* the user are deliberately
excluded, because someone else's knowledge is not part of your brain.

### QA

| Check | Status |
|---|---|
| Personal knowledge remains private | **DONE** — owner-scoped; another user sees nothing |
| Deleting the original project does not delete promoted knowledge | **DONE** — asserted against real Postgres |
| Unpromoted working data disappears according to project lifecycle | **DONE** |
| Account deletion removes personal KBs, chunks, embeddings, storage | **DONE** — asserted |

The project-deletion guarantee is the one that matters most: `source_ref` is plain
text with no foreign key to `files`, so a promoted source is not cascade-deleted
with its origin. That was previously accidental; it is now pinned by a test, and
the provenance still names the deleted project so a reader can tell where the
entry came from.

---

# Administration And Governance

## Phase 7: Sharing And Access — DONE

| Item | Status |
|---|---|
| Share KBs with users and groups | DONE — `/grants`, viewer and editor |
| Viewer and editor access | DONE |
| Share projects independently from KBs | DONE — owner-managed user, group, and role grants |
| Project access does not grant KB administration | DONE — attaching requires the actor's own `knowledge.read` |
| Enforce authorization at repository and retrieval boundaries, not only UI | DONE |

### QA

| Check | Status |
|---|---|
| Direct-ID and cross-user denial matrix | DONE |
| Retrieval cannot return inaccessible chunks | DONE |
| Revoked access stops working immediately | DONE |
| Sharing a project does not leak unrelated KBs | DONE — project grants are a separate resource type; attached bases are re-authorized independently |
| Convex and Postgres authorization contracts behave identically | DONE — 7/7 both |

Project owners manage viewer and editor grants in Project Settings. Editors can
change project working content but cannot reshare, revoke access, delete, or
administer attached knowledge bases. The sharing service validates every
principal against the active directory and records grant/revocation audit
events. Removing a grant takes effect on the next request because access is
resolved from durable ACL state rather than cached into the project record.

---

## Phase 8: Admin Distribution — DONE

| Item | Status |
|---|---|
| Admin creates organizational KBs | DONE — `kind: 'organization'`, gated on `knowledge.publish` |
| Admin assigns KB access to users and groups | DONE |
| Admin controls available models, tools, and connectors | DONE — catalog policies are enforced in bootstrap, integration routes, connector execution, and the agent tool surface |
| Admin can inspect indexing health and usage | DONE — organization-wide view reports source, chunk, embedding, freshness, stale, failed, and pending counts |
| Admin can set default KBs for groups | DONE — schema 26; current group membership is rechecked at fallback resolution |
| Core schema stays horizontal, no education-specific concepts | DONE — upheld |

### QA

| Check | Status |
|---|---|
| Admin and ordinary-user browser suites | PARTIAL — roles panel verified with fixtures; full matrix manual |
| Group membership changes propagate correctly | DONE |
| Admin-created KBs remain reusable across unrelated projects | DONE |
| Capability gates match actual deployment support | DONE |
| Audit every administrative mutation | DONE |

Admin panel views today: overview, roles, groups, knowledge, catalog.

### Distribution semantics

- A group default is fallback knowledge only. It applies when a chat has no
  explicit mention, conversation attachment, or project attachment.
- Explicit and project scopes always win, so a default cannot silently widen a
  hard retrieval boundary.
- Removing a user from a group takes effect on the next request because defaults
  are resolved against current membership rather than copied onto the user.
- Catalog resources remain open to capability-bearing users until the first
  exact or wildcard grant is configured. Once restricted, only matching users,
  groups, or roles can see or execute the resource.
- Deployment capabilities remain the outer hard limit. Administrative catalog
  policy can only narrow models, tools, and connectors; it cannot enable a
  disabled provider.

---

## Phase 9: Custom Authorization And Policies — PARTIAL

| Item | Status |
|---|---|
| Admin-defined roles | DONE |
| Capabilities assembled into roles | DONE — versioned, code-defined catalog |
| User and group role assignments | DONE |
| Resource ACLs | DONE — `resource_grants` with viewer, editor, owner |
| Project and KB policy rules | PARTIAL — route-level policies exist; no admin-authored policy objects |
| Audit logs | DONE |
| Access reviews and compliance exports | TODO |
| Versioning, retention, legal hold, approval workflows | TODO |

Evaluation order is `deployment hard limits` intersected with
`role/group/user capabilities` intersected with `resource ACL`, deny-by-default,
with no explicit-deny rules in v1.

---

# Recommended Execution Order

| # | Step | Status |
|---|---|---|
| 1 | Finish Knowledge Base Core | DONE |
| 2 | Run full basic Knowledge QA | PARTIAL — visual-state QA outstanding |
| 3 | Finish Project Core | DONE |
| 4 | Run full basic Project QA | DONE |
| 5 | Attach one KB per project | DONE |
| 6 | Run comparative distinction QA | DONE |
| 7 | Stabilize both Convex and Postgres contracts | DONE |
| 8 | Add rich retrieval and multiple KBs | DONE |
| 9 | Add mature project workflows | PARTIAL — 4.5 of 9 |
| 10 | Add personal brains | **DONE** |
| 11 | Add sharing and organization distribution | PARTIAL |
| 12 | Add custom roles, ACLs, governance, and versioning | PARTIAL — authz done, governance not |

The critical milestone at the end of Phase 3 has been met:

> Projects are where you work. Knowledge bases are what you trust.

Everything afterward should deepen that distinction instead of blurring it.

---

# Verification Commands

```bash
# Knowledge bases, cumulative through Phase 4
npm run test:knowledge-bases:phase9

# Phase 4 retrieval quality, isolation, latency, pgvector plan (Postgres only)
npm run test:knowledge-bases:retrieval-quality

# Projects
npm run test:projects:core

# Dual-backend repository contracts
npm run test:knowledge-bases:postgres:remote
npm run test:knowledge-bases:convex
npm run test:authorization:persistence:postgres:remote
npm run test:authorization:persistence:convex

# Embedding-identity drift (Postgres only; needs database credentials only)
npm run knowledge:embedding-drift
npm run knowledge:embedding-migrate

# Boundary and config gates
npm run check:config
npm run check:providers
npm run check:on-prem-parity
npm run check:shared-isomorphic
npm run docs:health
```

Postgres contract runs need `.env.on-prem-contract-tests.local` with
`OVERLAY_DATABASE_URL` pointed at a disposable database. These suites are
destructive: never point them at pilot or production data.

---

# Open Issues

1. **Convex dev-schema drift with `overlay-landing-agentos`.** Pushing this
   branch's schema to the shared dev deployment removes that branch's
   `workspace*` indexes, which exist in neither this branch, `main`, nor
   `staging`. Production is unaffected. Needs a schema union or a re-push from
   that worktree.
2. **`check:module-boundaries` fails** on
   `packages/overlay-modules-react/src/knowledge/file-viewer.tsx` for direct
   fetch calls. Pre-existing, confirmed on pristine HEAD.
3. **Convex and Vercel deploy coupling.** Vercel does not deploy `convex/`, so
   any change touching it must run `npm run convex:push:all` or staging will 404
   on new functions. Not yet a CI step.
4. **Connector and drive fetchers return 501.** Deliberate, but the source kinds
   are visible in the API surface.
5. **Visual-state QA** for empty, loading, error, mobile, light, and dark states
   has not been run for the knowledge surfaces.
