# Overlay Agent Bridge Protocol

`@layernorm/overlay-agent-bridge-protocol` is the versioned enrollment, signed host-request and local-tool
contract shared by Overlay and `@layernorm/overlay-agent-host`, which lets Overlay's own agents use the
machine it runs on. It contains strict Zod schemas, canonical signature payloads, limits and TypeScript
types. It also holds what Overlay's cloud harness and the host's private threads share: the computer tools'
inputs, approval rules and browser result text (`computer-tools.ts`) and context compaction (`agent-context.ts`).

Install the matching protocol and host versions together:

```sh
npm install @layernorm/overlay-agent-bridge-protocol@0.8.0 @layernorm/overlay-agent-host@0.8.0
```

See the repository's `internal/develop/local-computer.md` for the trust and compatibility policy.
