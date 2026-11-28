# Contributing to Overlay Desktop

Contributions are welcome. For a large change, open an issue first describing
the problem and the scope. Report security issues only through `SECURITY.md`.

Use an Apple Silicon Mac and Node.js 22 or newer:

```bash
cp .env.example .env
bun install --frozen-lockfile
bun run dev
```

Before opening a pull request:

```bash
bun run lint
bun run test
bun run build
```

Don't commit secrets, certificates, downloaded models, build output or user data.
Native capabilities stay owned and validated by the main process; never let the
web page bypass that.

Contributions are licensed under `AGPL-3.0-or-later`.
