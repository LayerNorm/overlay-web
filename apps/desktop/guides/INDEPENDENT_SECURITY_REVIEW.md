# Independent security review

Gate A and Gate B require a reviewer who is independent of the implementation
agents. A green internal suite is evidence for that review, not a substitute for
it.

## Reviewer qualifications

The reviewer should have demonstrated experience with Electron renderer
boundaries, native OAuth and token storage, macOS app signing, hostile-client
billing abuse, AI-agent prompt injection, SSRF/browser isolation, and software
supply-chain review.

## Inputs

- the private source repository and full history;
- the exact history-free public export candidate;
- the canonical Overlay Server source and deployed test environment;
- a signed/notarized macOS arm64 release candidate;
- SBOM, release manifest, provenance, signing identity, and CI logs;
- the private consolidated audit and remediation evidence.

Do not send production credentials or customer data. Use dedicated test
accounts, provider projects with hard spend caps, synthetic documents, and
isolated macOS test machines.

## Required adversarial chains

1. **Hostile free client to owner-funded spend:** remove client checks; try model
   substitution, identity substitution, replay, concurrent reservations,
   disconnect/retry abuse, and direct provider-key retrieval.
2. **Malicious content to host side effect:** inject instructions through web
   pages, documents, memories, tool/integration results, and model output; try
   shell, filesystem, browser, package, AppleScript, and integration mutations
   in both Ask for approval and Full access.
3. **Renderer compromise to token or RCE:** enumerate preload globals, forge
   every IPC family from every window/frame/origin, mutate arguments during
   approval, send cyclic/oversized/high-concurrency input, and attempt raw auth,
   environment, navigation, and runtime access.
4. **Stolen app data to account takeover:** copy the entire user-data directory
   to another macOS account/device and inspect cookies, logs, caches, settings,
   downloads, permissions, server profiles, and auth state.
5. **Release compromise:** alter dependencies, native helpers, ASAR contents,
   update metadata, CI inputs, source SHA, and publishing credentials; verify
   every mutation fails a gate or signature/provenance check.

## Internal evidence commands

Run from a clean standalone checkout:

```bash
npm ci
npm run check:standalone
npm run license:check
npm run security:verify:source
npm run build
npm run generate:sbom
```

Run the backend negative-security suite from the canonical Overlay Server
repository, including both Convex and Postgres contract configurations. The
remote-provider suites require dedicated non-production deployments and are not
replaced by mocked unit tests.

For the final signed candidate:

```bash
npm run verify:mac-artifact
```

## Acceptance record

The reviewer must record the source commit, server deployment, artifact hashes,
test date, tools and versions, tested macOS version, findings, and residual
risks. Every Critical must be fixed. Every High must be fixed unless the
reviewer explicitly agrees to a written exception with a compensating control,
owner, and expiry.

The accepted desktop-chat exception must be called out plainly: Full access is
unsandboxed host execution, microVM isolation is deferred, and the exception
expires or must be renewed by 2027-01-24.
