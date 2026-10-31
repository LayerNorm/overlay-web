import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
test('compiler wrapper fails on absent routes and enforces Bun in CI while preserving the local fallback', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'overlay-compiler-test-'));
  try {
    mkdirSync(path.join(root, 'scripts/ci'), { recursive: true });
    copyFileSync(path.join(sourceRoot, 'scripts/ci/typecheck-native.mjs'), path.join(root, 'scripts/ci/typecheck-native.mjs'));
    const run = ci => spawnSync(process.execPath, ['scripts/ci/typecheck-native.mjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, CI: ci, OVERLAY_TYPECHECK_BUN_BINARY: path.join(root, 'missing-bun') },
    });
    assert.notEqual(run('true').status, 0);
    assert.match(run('true').stderr, /Missing .next\/types/);
    mkdirSync(path.join(root, '.next/types'), { recursive: true });
    for (const file of ['routes.d.ts', 'validator.ts']) writeFileSync(path.join(root, '.next/types', file), '');
    mkdirSync(path.join(root, 'node_modules/typescript/bin'), { recursive: true });
    const fallback = path.join(root, 'node_modules/typescript/bin/tsc');
    writeFileSync(fallback, 'console.log("local-fallback-ran");');
    const required = run('true');
    assert.notEqual(required.status, 0);
    assert.match(required.stderr, /requires Bun 1.4.4/);
    assert.doesNotMatch(required.stdout, /local-fallback-ran/);
    const local = run('false');
    assert.equal(local.status, 0, local.stderr);
    assert.match(local.stdout, /local-fallback-ran/);
    writeFileSync(fallback, 'process.exit(7);');
    assert.equal(run('false').status, 7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
