#!/usr/bin/env node
/**
 * Shadow experiment only: never replaces or disables the required ESLint check.
 * Install pinned experimental tools outside the repo, then run:
 * npm install --prefix /tmp/overlay-oxlint --no-package-lock --ignore-scripts \
 *   --no-audit --no-fund oxlint@1.90.0 @oxlint/migrate@1.90.0
 * node scripts/ci/lint-oxlint-parity.mjs --tool-root /tmp/overlay-oxlint \
 *   --file src/components/brand/BrandLockup.tsx
 *
 * Exit 1 means diagnostic parity failed; 2 means the experiment could not run.
 * This checks critical negative fixtures plus explicitly selected real source.
 * Passing is necessary, never sufficient, to promote a replacement: every active
 * rule/option, inline suppression and scoped ignore still needs parity review.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const version = '1.90.0';

export const fixtures = [
  { name: 'valid shared module', path: 'src/shared/__lint_parity_valid.ts', code: 'export const value: number = 1;\n', expected: [] },
  { name: 'shared server import', path: 'src/shared/__lint_parity_import.ts', code: 'export { value } from "@/server/private";\n', expected: ['no-restricted-imports'] },
  { name: 'shared process.env', path: 'src/shared/__lint_parity_env.ts', code: 'export const value = process.env.VALUE;\n', expected: ['no-restricted-syntax'] },
  { name: 'shared env exception', path: 'src/shared/env/public-env.ts', code: 'export const value = process.env.VALUE;\n', expected: [] },
  { name: 'shared test exception', path: 'src/shared/__lint_parity_import.test.ts', code: 'export { value } from "@/server/private";\n', expected: [] },
  ...['button', 'input', 'textarea', 'select'].map(tag => ({ name: `raw ${tag}`, path: `src/components/__lint_parity_${tag}.tsx`, code: `export const Probe = () => <${tag} />;\n`, expected: ['no-restricted-syntax'] })),
  { name: 'documented raw-control exception', path: 'src/components/__lint_parity_exception.tsx', code: '// overlay:raw-control Native file-picker semantics.\n// eslint-disable-next-line no-restricted-syntax\nexport const Probe = () => <input type="file" />;\n', expected: [] },
  { name: 'server catch binding', path: 'src/server/shared/__lint_parity_catch.ts', code: 'export function probe() { try { throw new Error("probe"); } catch { return 1; } }\n', expected: ['no-restricted-syntax'] },
  { name: 'server console', path: 'src/server/shared/__lint_parity_console.ts', code: 'export function probe() { console.log("probe"); }\n', expected: ['no-console'] },
  { name: 'server test exception', path: 'src/server/shared/__lint_parity_console.test.ts', code: 'export function probe() { console.log("probe"); }\n', expected: [] },
  { name: 'cross-feature boundary', path: 'src/features/chat/__lint_parity_cross.ts', code: 'export { value } from "@/features/billing/private";\n', expected: ['no-restricted-imports'] },
  { name: 'legacy boundary warning', path: 'src/components/layout/PageNavbar.tsx', code: 'export { value } from "@/features/billing/private";\n', expected: ['no-restricted-imports'] },
  ...[
    ['import', 'import value from "../../apps/admin/private"; export { value };'],
    ['export', 'export { value } from "../../apps/admin/private";'],
    ['export-all', 'export * from "../../apps/admin/private";'],
    ['dynamic-import', 'export const value = import("../../apps/admin/private");'],
  ].map(([kind, code]) => ({ name: `standalone app ${kind}`, path: `src/shared/__lint_parity_app_${kind}.ts`, code: `${code}\n`, expected: ['app-separation/imports'] })),
  { name: 'conditional hook', path: 'src/components/__lint_parity_hook.tsx', code: 'import { useState } from "react";\nexport function Probe({ show }: { show: boolean }) { if (show) { const [value] = useState(0); return <div>{value}</div>; } return null; }\n', expected: ['react-hooks/rules-of-hooks'] },
  { name: 'synchronous Next script', path: 'src/components/__lint_parity_script.tsx', code: 'export const Probe = () => <script src="https://example.invalid/probe.js" />;\n', expected: ['@next/next/no-sync-scripts'] },
  { name: 'explicit any', path: 'src/shared/__lint_parity_any.ts', code: 'export const value: any = 1;\n', expected: ['@typescript-eslint/no-explicit-any'] },
  { name: 'ESLint inline suppression', path: 'src/shared/__lint_parity_suppression.ts', code: '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const value: any = 1;\n', expected: [] },
];

export function canonicalRule(rule) {
  const match = /^([^()]+)\(([^()]+)\)$/.exec(rule);
  if (!match) return rule;
  const [, plugin, name] = match;
  if (plugin === 'eslint') return name;
  if (plugin === 'typescript') return `@typescript-eslint/${name}`;
  if (plugin === 'next' || plugin === 'nextjs') return `@next/next/${name}`;
  if (plugin === 'react' && ['rules-of-hooks', 'exhaustive-deps', 'static-components', 'use-memo', 'preserve-manual-memoization', 'incompatible-library', 'immutability', 'globals', 'refs', 'set-state-in-effect', 'error-boundaries', 'purity', 'set-state-in-render', 'unsupported-syntax'].includes(name)) return `react-hooks/${name}`;
  return `${plugin}/${name}`;
}

function run(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) throw new Error(`${executable} exited ${result.status}: ${result.stderr}`);
  return result;
}

function difference(left, right) {
  const remaining = [...right];
  return left.filter(item => {
    const index = remaining.findIndex(other => JSON.stringify(item) === JSON.stringify(other));
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

async function main() {
  const args = process.argv.slice(2);
  let toolRoot;
  const files = [];
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    if (option === '--tool-root') toolRoot = resolve(value);
    else if (option === '--file') files.push(value);
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!toolRoot) throw new Error('Pass --tool-root pointing to an external installation of oxlint@1.90.0 and @oxlint/migrate@1.90.0.');
  for (const name of ['oxlint', '@oxlint/migrate']) {
    const pkg = JSON.parse(await readFile(join(toolRoot, 'node_modules', name, 'package.json'), 'utf8'));
    assert.equal(pkg.version, version, `Pin ${name} to ${version}; a version change needs a fresh parity review.`);
  }
  const cases = [...fixtures];
  for (const file of files) {
    const path = relative(root, resolve(root, file));
    assert(!path.startsWith('..') && !isAbsolute(path), `File must be inside the repository: ${file}`);
    cases.push({ name: `source: ${path}`, path, code: await readFile(join(root, path), 'utf8') });
  }
  const temporary = await mkdtemp(join(tmpdir(), 'overlay-lint-parity-'));
  const generatedName = `.cache/lint-parity-${process.pid}.json`;
  const generatedPath = join(root, generatedName);
  try {
    await mkdir(dirname(generatedPath), { recursive: true });
    const migration = run(process.execPath, [join(toolRoot, 'node_modules/@oxlint/migrate/dist/bin/oxlint-migrate.mjs'), 'eslint.config.mjs', '--js-plugins=false', '--details', '--output-file', generatedName], root);
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);
    const configPath = join(temporary, '.oxlintrc.json');
    await writeFile(configPath, await readFile(generatedPath));
    const eslint = new ESLint({ cwd: root, cache: false });
    const reports = [];
    for (const fixture of cases) {
      const eslintResults = await eslint.lintText(fixture.code, { filePath: fixture.path });
      const baseline = eslintResults.flatMap(result => result.messages.map(message => ({ rule: message.ruleId ?? 'parser', severity: message.severity, line: message.line ?? 1 })));
      if (fixture.expected) {
        const actualRules = [...new Set(baseline.map(message => message.rule))].sort();
        assert.deepEqual(actualRules, [...fixture.expected].sort(), `ESLint baseline fixture is invalid: ${fixture.name}`);
      }
      const path = join(temporary, fixture.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, fixture.code);
      // Relative config/file paths share one root even on macOS, where /tmp
      // and /var may resolve to /private paths inside the native executable.
      const output = run(join(toolRoot, 'node_modules/.bin/oxlint'), ['--threads', '1', '--config', '.oxlintrc.json', '--format', 'json', fixture.path], temporary);
      let parsed;
      try { parsed = JSON.parse(output.stdout); } catch { throw new Error(`Oxlint failed for ${fixture.name}: ${output.stderr || output.stdout}`); }
      assert.equal(parsed.number_of_files, 1, `Oxlint skipped ${fixture.name}`);
      const candidate = parsed.diagnostics.map(diagnostic => ({ rule: canonicalRule(diagnostic.code ?? 'parser'), severity: diagnostic.severity === 'error' ? 2 : 1, line: diagnostic.labels?.[0]?.span?.line ?? 1 }));
      reports.push({ name: fixture.name, path: fixture.path, missing: difference(baseline, candidate), extra: difference(candidate, baseline), eslintDiagnostics: baseline.length, oxlintDiagnostics: candidate.length });
      await rm(path);
    }
    const mismatches = reports.filter(report => report.missing.length || report.extra.length);
    console.log(JSON.stringify({ mode: 'shadow-only', version, promotionReady: false, comparison: 'rule, severity and line; message wording and column spans are not compared', migration: `${migration.stdout}\n${migration.stderr}`.trim(), cases: reports.length, mismatches: mismatches.length, reports }, null, 2));
    process.exitCode = mismatches.length ? 1 : 0;
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(generatedPath, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack ?? error); process.exitCode = 2; });
}
