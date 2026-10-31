#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUN_TYPECHECK_VERSION = '1.4.4';
// TS7 deliberately stopped automatically including every installed @types package.
// Preserve the existing TS5 project's ambient scope instead of silently losing it.
export function legacyAmbientConfig(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const ts = require('typescript');
  if (typeof ts.getAutomaticTypeDirectiveNames !== 'function') throw new Error('The legacy TypeScript compiler API is required to preserve ambient types');
  const configPath = path.join(root, 'tsconfig.json');
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) throw new Error('Cannot read the application tsconfig');
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root);
  if (parsed.errors.length) throw new Error('Cannot parse the application tsconfig');
  const directory = mkdtempSync(path.join(tmpdir(), 'overlay-typecheck-config-'));
  const config = path.join(directory, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({ extends: configPath, compilerOptions: {
    types: ts.getAutomaticTypeDirectiveNames(parsed.options, ts.sys),
    typeRoots: ts.getEffectiveTypeRoots(parsed.options, ts.sys),
  } }), { mode: 0o600 });
  return { config, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--require-bun')) throw new Error('Usage: node scripts/ci/typecheck-native.mjs [--require-bun]');
  for (const file of ['.next/types/routes.d.ts', '.next/types/validator.ts']) {
    if (!existsSync(path.join(root, file))) throw new Error(`Missing ${file}; run next typegen before typechecking`);
  }
  const bun = process.env.OVERLAY_TYPECHECK_BUN_BINARY || 'bun';
  const version = spawnSync(bun, ['--version'], { encoding: 'utf8' });
  const available = !version.error && version.status === 0 && version.stdout.trim() === BUN_TYPECHECK_VERSION;
  const required = args.includes('--require-bun') || Boolean(process.env.CI && process.env.CI !== 'false');
  if (!available) {
    if (required) throw new Error(`CI typechecking requires Bun ${BUN_TYPECHECK_VERSION}; no fallback was run`);
    console.log(`typecheck: Bun ${BUN_TYPECHECK_VERSION} unavailable; using the installed TypeScript compiler`);
    const checked = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: root, stdio: 'inherit' });
    if (checked.error || checked.status !== 0) process.exitCode = checked.status || 1;
    return;
  }
  const temporary = legacyAmbientConfig(root);
  try {
    const checked = spawnSync(bun, ['check', '--no-script', '-p', temporary.config, '--noEmit'], { cwd: root, stdio: 'inherit' });
    if (checked.error || checked.status !== 0) process.exitCode = checked.status || 1;
  } finally {
    temporary.cleanup();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
