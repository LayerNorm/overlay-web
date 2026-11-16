# E2B sandbox adapter (self-hosting)

`packages/overlay-sandbox-runtime/src/e2b.ts` implements the sandbox runtime on E2B. Set:

```
OVERLAY_MANAGED_SANDBOX_PROVIDER=e2b
E2B_API_KEY=...
OVERLAY_E2B_TEMPLATE=<template configured for this self-hosted deployment>
```

Sandboxes use `onTimeout: 'pause'`, `autoResume: false`; Overlay's own idle meter stops them. Billing uses the E2B rate card in `ManagedAgentSandboxBilling.ts`. Tested against a fake SDK only; not run against real E2B.
