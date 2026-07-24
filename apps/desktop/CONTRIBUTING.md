# Contributing to Overlay Desktop

Contributions are welcome. Before starting a large change, open a public issue
that describes the user problem and proposed scope. Report security issues only
through the private process in `SECURITY.md`.

## Development

Use an Apple Silicon Mac and Node.js 22 or newer:

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Before submitting a change, run the smallest relevant checks and, for
cross-cutting changes, the full baseline:

```bash
npm run typecheck
npm test
npm run build
npm run check:dependencies:all
npm run license:check
```

Do not commit secrets, production endpoints that are not intentionally public,
private audit reports, certificates, provisioning profiles, downloaded models,
build output, local databases, or user data.

Changes to host capabilities must preserve main-process authority, sender
binding, validation, least privilege, and the default Ask-for-approval
behavior. Do not add a renderer-controlled bypass or silently widen Full access.

By contributing, you agree that your contribution is licensed under the
license governing the directory you modify: `AGPL-3.0-or-later` for the desktop
product and `Apache-2.0` for `packages/*`.
