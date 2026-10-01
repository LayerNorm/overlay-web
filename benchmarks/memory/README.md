# Memory benchmark harness

Measures Overlay's memory system against LoCoMo and ConvoMem (LME-V2
descoped) for pre/post M1–M3 comparison. **All LLM calls use
`inclusionai/ling-3.0-flash-vl-free` via the Vercel AI Gateway** — no paid
models. Datasets and results are gitignored and deleted after sign-off.

## Baseline (`run-id: pre-m1`, 2026-09-22)

| Benchmark | Score |
|---|---|
| LoCoMo (full, 1,986 QAs) | **28.0%** |
| ConvoMem (90-QA subset) | **73.3%** |

Per-category tables: `results/pre-m1/report.md`.

## What it exercises

Real code paths, not a mock:

- **Extraction** — identical prompts/schema/filters as
  `convex/knowledge/memoryExtractorNode.ts` via
  `src/shared/knowledge/memory-extraction-shared.ts`, run locally with the
  free model (`internalAction`s can't be called externally).
- **Storage** — real `knowledge/memories:add` mutation → real
  `reindexMemoryInternal` → real embeddings on dev Convex.
- **Retrieval** — real `knowledge/knowledge:hybridSearch` action, formatted by
  the real `formatAutoRetrievalBundle`.
- **Answer/judge** — fixed prompts on the free model. LME-V2 uses its own
  declarative `eval_function` matchers where deterministic.

## Setup

```bash
# needs .env.local with AI_GATEWAY_API_KEY, INTERNAL_API_SECRET,
# DEV_NEXT_PUBLIC_CONVEX_URL (hard-refuses the production Convex host)

npx tsx benchmarks/memory/smoke.ts            # REQUIRED first — validates env,
                                              # indexing, retrieval, cleanup

npx tsx benchmarks/memory/src/download.ts locomo       # ~5MB
npx tsx benchmarks/memory/src/download.ts convomem     # ~small subset
npx tsx benchmarks/memory/src/download.ts longmemeval  # ~1.2GB (skip unless needed)
```

## Runs

```bash
# LoCoMo smoke subset (~1 conversation, first 50 msgs)
npx tsx benchmarks/memory/src/runner.ts locomo --limit-cases 1 --max-messages 50 --run-id smoke-locomo

# LoCoMo full baseline (10 conversations, ~1986 QAs — hours at free-model latency)
npx tsx benchmarks/memory/src/runner.ts locomo --run-id pre-m1

# ConvoMem subset (15 items/category default; --limit-cases sets items/category)
npx tsx benchmarks/memory/src/runner.ts convomem --limit-cases 5 --run-id pre-m1

# LongMemEval-V2 smallest-25 (bulk transcript ingestion, no per-message extraction)
npx tsx benchmarks/memory/src/runner.ts longmemeval --limit-cases 25 --run-id pre-m1
```

Resume: re-run the same `--run-id`; completed cases/questions are skipped.
`--keep` retains bench users' memories for inspection. `--bulk-only` skips
per-message extraction (transcript-as-memory baseline).

## Reports

```bash
npx tsx benchmarks/memory/src/report.ts pre-m1                 # per-category accuracy
npx tsx benchmarks/memory/src/report.ts pre-m1 post-m3         # side-by-side compare
```

Outputs `results/<run-id>/{*-qa.jsonl,*-ingest.jsonl,*-summary.json,report.md}`.

## Known protocol deviations (documented, consistent across runs)

- Answer+judge model is the free ling model, not the published gpt-* judges —
  absolute numbers vs. leaderboards are approximate; pre/post deltas are clean.
- ConvoMem/LME-V2 run bounded subsets (full suites are 75k QAs / 115M-token
  haystacks — disproportionate for a directional baseline).
- LME-V2 trajectories are compacted into step-blocks and bulk-ingested —
  measures retrieval over agent histories, not per-turn extraction.
- LoCoMo adversarial (cat-5) and ConvoMem abstention questions score correct
  only when the system declines.

## Cleanup

`results/` holds checkpoints — inspect before deleting. Per the task rules,
`benchmarks/memory/datasets/` is deleted only after owner approval.
