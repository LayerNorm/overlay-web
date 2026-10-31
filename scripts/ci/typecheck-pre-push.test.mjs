import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
test('pre-push typechecking preserves project scope and fails closed', () => {
const dir = mkdtempSync(path.join(tmpdir(), 'overlay-hook-test-'));
const run=(bin,args)=>spawnSync(bin,args,{cwd:dir,encoding:'utf8'});
const git=(...args)=>{const r=run('git',args);assert.equal(r.status,0,r.stderr);return r.stdout.trim()};
try {
 mkdirSync(path.join(dir,'scripts/ci'),{recursive:true});
 copyFileSync(path.join(sourceRoot, 'scripts/ci/typecheck-pre-push.mjs'),path.join(dir,'scripts/ci/typecheck-pre-push.mjs'));
 git('init','-q');git('config','user.name','QA');git('config','user.email','qa@example.invalid');git('add','.');git('commit','-qm','base');
 const base=git('rev-parse','HEAD');
 writeFileSync(path.join(dir,'README.md'),'docs');git('add','.');git('commit','-qm','docs');
 const check=(range,plan=true)=>run('node',['scripts/ci/typecheck-pre-push.mjs','--range',range,...(plan?['--plan']:[])]);
 assert.match(check(`${base}..HEAD`).stdout,/no application/);
 assert.notEqual(check('not-a-ref..HEAD').status,0);
 mkdirSync(path.join(dir,'src'));writeFileSync(path.join(dir,'src/app.ts'),'export const x = 1;');git('add','.');git('commit','-qm','web');
 assert.equal(JSON.parse(check(`${base}..HEAD`).stdout).web,true);
 assert.notEqual(check(`${base}..HEAD`,false).status,0); // Missing deps cannot pass.
 writeFileSync(path.join(dir,'src/app.ts'),'export const x = "uncommitted";');
 assert.match(check(`${base}..HEAD`,false).stderr,/uncommitted/);
 git('restore','src/app.ts');
 const beforeTests=git('rev-parse','HEAD');writeFileSync(path.join(dir,'scripts/ci/typecheck-probe.test.mjs'),'export {};');git('add','.');git('commit','-qm','tests');assert.match(check(`${beforeTests}..HEAD`).stdout,/no application/);
 const beforeAdmin=git('rev-parse','HEAD');mkdirSync(path.join(dir,'apps/admin/src'),{recursive:true});writeFileSync(path.join(dir,'apps/admin/src/app.ts'),'export const x = 1;');git('add','.');git('commit','-qm','admin');
 const admin=JSON.parse(check(`${beforeAdmin}..HEAD`).stdout);assert.equal(admin.web,false);assert.equal(admin.admin,true);
 assert.match(check(`${base}..${beforeAdmin}`,false).stderr,/check out the pushed revision/);

} finally {rmSync(dir,{recursive:true,force:true})}

});
