# Overlay Agent Bridge Protocol

`@overlay/agent-bridge-protocol` is the versioned command, event, enrollment, and host-request
contract shared by Overlay and `@overlay/agent-host`. It contains strict Zod schemas, canonical
signature payloads, protocol limits, and TypeScript types; it does not start an agent by itself.

Install the matching protocol and host versions together:

```sh
npm install @overlay/agent-bridge-protocol@0.1.0 @overlay/agent-host@0.1.0
```

Protocol version 1 fails closed on unknown versions, invalid event sequences, oversized payloads,
and malformed filesystem grants. See the repository's
`docs/develop/bring-your-own-agents.md` for the complete trust and compatibility policy.
