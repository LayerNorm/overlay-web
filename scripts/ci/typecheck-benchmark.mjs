#!/usr/bin/env node
// Shadow comparison only: never substitutes for the required project typecheck.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { legacyAmbientConfig } from './typecheck-native.mjs';

const argv = process.argv.slice(2);
const options = {};
for (let i = 0; i < argv.length; i += 2) {
  if (!['--baseline', '--native', '--bun', '--output', '--runs'].includes(argv[i]) || !argv[i + 1]) {
    throw new Error('Usage: node scripts/ci/typecheck-benchmark.mjs --baseline /path/to/tsc [--native /path/to/tsc] --bun /path/to/bun --output /private/path/results.json [--runs 5]');
  }
  if (options[argv[i]]) throw new Error(`Duplicate option ${argv[i]}`);
  options[argv[i]] = argv[i + 1];
}
for (const key of ['--baseline', '--bun', '--output']) {
  if (!options[key] || !path.isAbsolute(options[key])) throw new Error(`${key} must be an absolute path`);
}
if (options['--native'] && !path.isAbsolute(options['--native'])) throw new Error('--native must be an absolute path');
const runs = Number(options['--runs'] ?? 5);
if (!Number.isInteger(runs) || runs < 5) throw new Error('At least five alternating rounds are required');
const root = process.cwd();
for (const file of ['tsconfig.json', '.next/types/routes.d.ts', '.next/types/validator.ts', 'convex/tsconfig.json']) {
  if (!existsSync(file)) throw new Error(`Missing ${file}; run Next route generation and prepare the complete checkout first`);
}
const temp = mkdtempSync(path.join(tmpdir(), 'overlay-typecheck-'));
const tools = [
  { name: 'baseline', bin: options['--baseline'], prefix: [] },
  ...(options['--native'] ? [{ name: 'native', bin: options['--native'], prefix: [] }] : []),
  { name: 'bun', bin: options['--bun'], prefix: ['check', '--no-script'] },
];
const aligned = legacyAmbientConfig(root);
const report = { runtime: { node: process.version, platform: process.platform, arch: process.arch }, revision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), runs, mode: 'cold compiler state; warm filesystem; no incremental cache', tools: {}, rounds: [], failures: [] };
function command(tool, args, cwd = root) {
  const start = performance.now();
  const result = spawnSync(tool.bin, [...tool.prefix, ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, AGENT: '', CLAUDECODE: '', REPL_ID: '', NO_COLOR: '1' } });
  if (result.error || result.signal) throw new Error(`${tool.name} did not execute: ${result.error?.message ?? result.signal}`);
  return { status: result.status, milliseconds: performance.now() - start, text: `${result.stdout}${result.stderr}` };
}
function diagnostics(text) {
  return [...text.matchAll(/(?:^|\n)([^\n]+?)\((\d+),(\d+)\): error TS(\d+):/g)].map((m) => `${m[1]}:${m[2]}:${m[3]}:TS${m[4]}`).sort();
}
try {
  const probe = path.join(temp, 'probe');
  mkdirSync(probe);
  writeFileSync(path.join(probe, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2017', ...JSON.parse(readFileSync(aligned.config, 'utf8')).compilerOptions, paths: { '@probe/model': ['./model.ts'] } }, files: ['entry.ts', 'model.ts'] }));
  writeFileSync(path.join(probe, 'model.ts'), 'export type Item = { kind: "file"; size: number } | { kind: "folder"; children: string[] };\n');
  writeFileSync(path.join(probe, 'entry.ts'), 'import type { Item } from "@probe/model";\nconst item: Item = { kind: "file", size: "wrong" };\nconst nullable: string = null;\nconst missing: number = doesNotExist;\nconst trusted: TrustedHTML = \"wrong\";\nexport { item, nullable, missing, trusted };\n');
  function identity(file) {
    if (!file.includes('node_modules/') || !/\.d\.[cm]?ts$/.test(file)) return file;
    let directory = path.dirname(path.resolve(root, file));
    while (directory !== path.dirname(directory)) {
      const manifest = path.join(directory, 'package.json');
      if (existsSync(manifest)) {
        const { name, version } = JSON.parse(readFileSync(manifest, 'utf8'));
        const hash = createHash('sha256').update(readFileSync(path.resolve(root, file))).digest('hex');
        return `${name}@${version}:${path.relative(directory, path.resolve(root, file))}:${hash}`;
      }
      directory = path.dirname(directory);
    }
    throw new Error(`Cannot identify declaration package: ${file}`);
  }
  let referenceFiles;
  for (const tool of tools) {
    const version = spawnSync(tool.bin, ['--version'], { encoding: 'utf8' });
    if (version.status !== 0) throw new Error(`${tool.name}: version command failed`);
    const negative = command(tool, ['-p', path.join(probe, 'tsconfig.json'), '--pretty', 'false']);
    const expected = ['2:36:TS2322', '3:7:TS2322', '4:25:TS2304', '5:7:TS2322'];
    const actual = diagnostics(negative.text);
    if (negative.status === 0 || actual.length !== expected.length || expected.some(code => !actual.some(item => item.endsWith(`:${code}`)))) throw new Error(`${tool.name}: negative probes were not fully checked`);
    const inventory = command(tool, ['-p', aligned.config, '--listFilesOnly', '--pretty', 'false']);
    if (inventory.status !== 0) throw new Error(`${tool.name}: project inventory failed: ${inventory.text.slice(0, 1500)}`);
    // Compiler standard libraries differ by version/location; all other reachable files must match.
    const files = inventory.text.split(/\r?\n/).filter(line => /\.(?:[cm]?tsx?|jsx?)$/.test(line) && !/[/\\](?:typescript|typescript-[^/\\]+)[/\\]lib[/\\]lib\.[^/\\]+\.d\.ts$/.test(line) && !line.startsWith('bundled:///libs/')).map(file => path.relative(root, file)).sort();
    const canonicalFiles = [...new Set(files.map(identity))].sort();
    if (files.length < 100 || !files.some(file => file === '.next/types/validator.ts') || !files.some(file => file.startsWith('convex/'))) throw new Error(`${tool.name}: incomplete project inventory`);
    report.tools[tool.name] = { version: version.stdout.trim(), files: files.length, canonicalFiles: canonicalFiles.length, negativeDiagnostics: diagnostics(negative.text) };
    if (referenceFiles && JSON.stringify(canonicalFiles) !== JSON.stringify(referenceFiles)) {
      report.failures.push(`${tool.name}: reachable file inventory differs`);
      report.tools[tool.name].missing = referenceFiles.filter(file => !canonicalFiles.includes(file));
      report.tools[tool.name].extra = canonicalFiles.filter(file => !referenceFiles.includes(file));
    }
    referenceFiles ??= canonicalFiles;
  }
  if (report.failures.length) throw new Error("File coverage differs; timing comparison is not valid");
  for (let round = 0; round < runs; round++) {
    const ordered = round % 2 ? [...tools].reverse() : tools;
    for (const tool of ordered) {
      const result = command(tool, ['-p', aligned.config, '--noEmit', '--incremental', 'false', '--pretty', 'false']);
      report.rounds.push({ round: round + 1, tool: tool.name, milliseconds: result.milliseconds, status: result.status, diagnostics: diagnostics(result.text) });
      if (result.status !== 0) {
        report.failures.push(`${tool.name}: project check failed in round ${round + 1}`);
        report.tools[tool.name].firstFailure ??= result.text.slice(0, 10000);
        throw new Error(`${tool.name}: cannot benchmark a failing project check`);
      }
      console.log(`round ${round + 1}: ${tool.name} ${(result.milliseconds / 1000).toFixed(2)}s (exit ${result.status})`);
    }
  }
  for (const tool of tools) {
    const values = report.rounds.filter(item => item.tool === tool.name).map(item => item.milliseconds).sort((a, b) => a - b);
    report.tools[tool.name].medianMilliseconds = values[Math.floor(values.length / 2)];
  }
} catch (error) {
  report.failures.push(error.message);
} finally {
  aligned.cleanup();
  rmSync(temp, { recursive: true, force: true });
  writeFileSync(options['--output'], `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
if (report.failures.length) {
  console.error(report.failures.join('\n'));
  process.exitCode = 1;
}
