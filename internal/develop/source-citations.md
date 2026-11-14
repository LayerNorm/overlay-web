# Source citations in assistant turns

Auto-retrieved knowledge uses numeric `Sources:` markers that can be linked to durable memory or file destinations. A same-turn successful external source result makes a bare numeric marker ambiguous, so Act persistence and personal harness final delivery leave those markers unlinked. Knowledge-only turns keep the existing numeric links, and explicit Markdown links are unchanged.

Use normalized assistant visual blocks with `collectWebSourcesFromBlocks` to decide whether external sources are present. Failed, denied, pending, malformed, and empty results do not suppress knowledge links. Keep this guard consistent in `ActMessagePersistenceService` and `personal-delivery.ts`; do not infer web URLs from numeric positions or persist raw tool output as source metadata. The underlying Markdown linkifier is unchanged.
