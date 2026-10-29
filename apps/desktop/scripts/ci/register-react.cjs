// tsx uses the classic JSX transform for package sources with jsx: preserve.
// Static JSX may execute during import, before a test can set globalThis.React.
// Initialize the test runtime here; production continues to use the normal
// automatic JSX runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
globalThis.React ??= require('react')
