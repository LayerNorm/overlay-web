#!/usr/bin/env node
import { existsSync } from 'node:fs'

if (existsSync(new URL('../dist/cli.js', import.meta.url))) {
  await import('../dist/cli.js')
} else {
  await import('tsx/esm')
  await import('./cli.ts')
}
