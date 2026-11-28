// Rebuild native dependencies for Electron after install. The desktop app is
// macOS-only; the monorepo's one install also runs on Linux (Vercel, CI web lanes),
// where there is no desktop build and the macOS-targeted native rebuild cannot compile.
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') process.exit(0)
const result = spawnSync('electron-builder', ['install-app-deps'], { stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(result.status ?? 1)
