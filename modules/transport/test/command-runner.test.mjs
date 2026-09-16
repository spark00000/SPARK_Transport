import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runProcess } from '../src/command-runner.mjs';

test('runProcess captures stdout/stderr/exit code',async()=>{
  const r=await runProcess({command:process.execPath,args:['-e','console.log("OUT");console.error("ERR")'],cwd:os.tmpdir(),timeoutMs:5000});
  assert.equal(r.ok,true);
  assert.match(r.stdout,/OUT/);
  assert.match(r.stderr,/ERR/);
  assert.equal(r.exitCode,0);
  assert.equal(r.stdoutTruncated,false);
  assert.equal(r.stderrTruncated,false);
});

test('runProcess reports nonzero and timeout',async()=>{
  let r=await runProcess({command:process.execPath,args:['-e','process.exit(7)'],cwd:os.tmpdir(),timeoutMs:5000});
  assert.equal(r.ok,false);
  assert.equal(r.exitCode,7);
  assert.equal(r.error.code,'COMMAND_FAILED');
  r=await runProcess({command:process.execPath,args:['-e','setTimeout(()=>{},5000)'],cwd:os.tmpdir(),timeoutMs:50});
  assert.equal(r.ok,false);
  assert.equal(r.error.code,'COMMAND_TIMEOUT');
});

test('runProcess bounds stdout and stderr independently',async()=>{
  const r=await runProcess({
    command:process.execPath,
    args:['-e',"process.stdout.write('x'.repeat(200000));process.stderr.write('y'.repeat(200000));"],
    cwd:os.tmpdir(),
    timeoutMs:5000,
    maxOutputBytes:4096,
  });
  assert.equal(r.ok,true);
  assert.equal(Buffer.byteLength(r.stdout),4096);
  assert.equal(Buffer.byteLength(r.stderr),4096);
  assert.equal(r.stdoutTruncated,true);
  assert.equal(r.stderrTruncated,true);
});

test('timeout terminates child process tree',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spark-tree-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const marker=path.join(dir,'orphan-marker.txt');
  const childScript=`setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'orphan'),1000);setInterval(()=>{},1000);`;
  const parentScript=`const{spawn}=require('child_process');spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const r=await runProcess({command:process.execPath,args:['-e',parentScript],cwd:dir,timeoutMs:250,maxOutputBytes:4096});
  assert.equal(r.ok,false);
  assert.equal(r.error.code,'COMMAND_TIMEOUT');
  assert.ok(r.durationMs<5000,`timeout result exceeded hard cleanup bound: ${r.durationMs}ms`);
  await new Promise(resolve=>setTimeout(resolve,1200));
  await assert.rejects(()=>fs.access(marker),error=>error?.code==='ENOENT');
});

test('parent exit does not wait forever for descendant-inherited stdio',async()=>{
  const childScript='setTimeout(()=>process.exit(0),1500);';
  const parentScript=`const{spawn}=require('child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{detached:true,stdio:['ignore','inherit','inherit']});c.unref();`;
  const started=Date.now();
  const r=await runProcess({command:process.execPath,args:['-e',parentScript],cwd:os.tmpdir(),timeoutMs:5000,maxOutputBytes:4096});
  const elapsed=Date.now()-started;
  assert.equal(r.ok,true);
  assert.ok(elapsed<1200,`parent result waited on descendant-held stdio for ${elapsed}ms`);
});
