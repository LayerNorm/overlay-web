# Overlay Agent Bridge Protocol

`@layernorm/overlay-agent-bridge-protocol` is the versioned enrollment, signed host-request and local-tool
contract shared by Overlay and `@layernorm/overlay-agent-host`, which lets Overlay's own agents use the
machine it runs on. It contains strict Zod schemas, canonical signature payloads, limits and TypeScript
types.

Install the matching protocol and host versions together:

```sh
npm install @layernorm/overlay-agent-bridge-protocol@0.7.0 @layernorm/overlay-agent-host@0.7.0
```

See the repository's `internal/develop/local-computer.md` for the trust and compatibility policy.
