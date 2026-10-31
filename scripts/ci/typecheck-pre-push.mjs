#!/usr/bin/env node
// Check complete projects, never changed filenames passed directly to tsc.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const rangeIndex = args.indexOf('--range');
if (rangeIndex < 0 || !args[rangeIndex + 1] || args.some((arg, index) => index !== rangeIndex && index !== rangeIndex + 1 && arg !== '--plan')) {
  throw new Error('Usage: node scripts/ci/typecheck-pre-push.mjs --range BASE..HEAD [--plan]');
}
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0 || result.error) throw new Error(`pre-push: Git ${args[0]} failed; typecheck was not run`);
  return result.stdout;
}
const range = args[rangeIndex + 1];
const changed = git(['diff', '--name-only', '-z', range]).split('\0').filter(Boolean);
const isSource = file => /\.[cm]?[jt]sx?$/.test(file) && !/\.test\.[cm]?[jt]sx?$/.test(file);
const rootRelevant = file => /^(?:src|convex|packages)\//.test(file) && (isSource(file) || /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json)$/.test(file))
  || /^(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|next\.config\.[cm]?[jt]s|next-env\.d\.ts|\.npmrc)$/.test(file)
  || /^scripts\/ci\/(?:check-|typecheck)/.test(file);
const adminRelevant = file => /^apps\/admin\//.test(file) && (isSource(file) || /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json)$/.test(file));
const web = changed.some(rootRelevant);
const admin = changed.some(adminRelevant) || web && changed.some(file => /^(?:packages\/|package(?:-lock)?\.json$)/.test(file));
if (!web && !admin) {
  console.log('pre-push: no application typecheck inputs changed');
  process.exit(0);
}
const commands = [];
if (web) commands.push(['node', ['node_modules/next/dist/bin/next', 'typegen']], ['npm', ['run', 'typecheck']]);
if (admin) commands.push(['node', ['node_modules/next/dist/bin/next', 'typegen', 'apps/admin']], ['npm', ['run', 'admin:typecheck']]);
if (args.includes('--plan')) {
  console.log(JSON.stringify({ web, admin, commands }));
  process.exit(0);
}
// A dirty checkout or another ref could mask errors in the revision being pushed.
const tip = git(['rev-parse', `${range.split('..').at(-1)}^{commit}`]).trim();
if (tip !== git(['rev-parse', 'HEAD']).trim()) throw new Error('pre-push: check out the pushed revision before typechecking');
const dirty = git(['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean);
const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
if ([...dirty, ...untracked].some(file => rootRelevant(file) || adminRelevant(file))) {
  throw new Error('pre-push: uncommitted application typecheck inputs could mask pushed errors; commit or isolate those edits first');
}
for (const required of ['node_modules/next/dist/bin/next', 'node_modules/typescript/bin/tsc']) {
  if (!existsSync(path.join(root, required))) throw new Error(`pre-push: missing ${required}; install dependencies first`);
}
for (const [bin, commandArgs] of commands) {
  console.log(`pre-push: ${bin} ${commandArgs.join(' ')}`);
  const result = spawnSync(bin, commandArgs, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
