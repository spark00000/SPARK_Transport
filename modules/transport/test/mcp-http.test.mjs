import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createSparkServer } from '../src/server.mjs';
import { freePort, headersFor, makeFixture, requestEnvelope } from './helpers.mjs';

test('server discover/list/call smoke exposes Sprint-2 tool set',async(t)=>{
  const f=await makeFixture();
  t.after(f.cleanup);
  const port=await freePort();
  const config={root:f.root,host:'127.0.0.1',port,mcpPath:'/mcp',healthPath:'/health',maxReadBytes:1024*1024,commandTimeoutMs:1000,maxCommandOutputBytes:4096,stateDir:path.join(f.base,'state'),recycleBin:true};
  const runtime=await createSparkServer(config,{recycle:async()=>{},runner:async()=>({ok:true,stdout:'',stderr:'',exitCode:0,durationMs:1})});
  await runtime.listen();
  t.after(()=>runtime.close());
  for(const body of [requestEnvelope('server/discover'),requestEnvelope('tools/list')]){
    const res=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:headersFor(body),body:JSON.stringify(body)});
    assert.equal(res.status,200);
    const json=await res.json();
    assert.equal(json.result.resultType,'complete');
    assert.equal(json.result._meta['io.modelcontextprotocol/serverInfo'].name,'SPARK');
    if(body.method==='tools/list')assert.equal(json.result.tools.length,10);
  }
  const call=requestEnvelope('tools/call',{name:'read_file',arguments:{path:'hello.txt'}});
  const res=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:headersFor(call),body:JSON.stringify(call)});
  const json=await res.json();
  const result=json.result.structuredContent;
  assert.equal(result.ok,true);
  assert.equal(result.operation,'read_file');
  assert.equal(result.changed,false);
  assert.match(result.operationId,/^op-/);
  assert.equal(result.data.text,'hello\n');
  const recent=await runtime.ledger.recent(5);
  assert.equal(recent.length,1);
  assert.equal(recent[0].operation,'read_file');
  assert.equal(recent[0].status,'success');
});

test('modern header mismatch rejected and GET SSE absent',async(t)=>{
  const f=await makeFixture();
  t.after(f.cleanup);
  const port=await freePort();
  const config={root:f.root,host:'127.0.0.1',port,mcpPath:'/mcp',healthPath:'/health',maxReadBytes:1024,stateDir:path.join(f.base,'state'),commandTimeoutMs:1000,maxCommandOutputBytes:4096,recycleBin:true};
  const rt=await createSparkServer(config);
  await rt.listen();
  t.after(()=>rt.close());
  const body=requestEnvelope('tools/list');
  const h=headersFor(body);
  h['mcp-method']='tools/call';
  let res=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:h,body:JSON.stringify(body)});
  assert.equal(res.status,400);
  res=await fetch(`http://127.0.0.1:${port}/mcp`);
  assert.equal(res.status,405);
  assert.equal(res.headers.get('mcp-session-id'),null);
});

test('bearer auth denies unauthenticated MCP calls and accepts the configured token',async(t)=>{
  const f=await makeFixture();
  t.after(f.cleanup);
  const port=await freePort();
  const token='spk_test_0123456789abcdef';
  const bearerTokenSha256=crypto.createHash('sha256').update(token,'utf8').digest('hex');
  const config={root:f.root,host:'127.0.0.1',port,mcpPath:'/mcp',healthPath:'/health',maxReadBytes:1024,stateDir:path.join(f.base,'state'),commandTimeoutMs:1000,maxCommandOutputBytes:4096,recycleBin:true,auth:{mode:'bearer',bearerTokenSha256}};
  const rt=await createSparkServer(config);
  await rt.listen();
  t.after(()=>rt.close());

  let res=await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status,200);
  const health=await res.json();
  assert.equal(health.version,'0.0.1');
  assert.equal(health.activity.active,null);
  assert.equal(health.activity.pendingUncertainMutation,null);

  const body=requestEnvelope('tools/list');
  res=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:headersFor(body),body:JSON.stringify(body)});
  assert.equal(res.status,401);
  assert.equal(res.headers.get('www-authenticate'),'Bearer realm="SPARK"');

  res=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{...headersFor(body),authorization:'Bearer wrong'},body:JSON.stringify(body)});
  assert.equal(res.status,401);

  res=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{...headersFor(body),authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  assert.equal(res.status,200);
  const json=await res.json();
  assert.equal(json.result.tools.length,10);
});

test('HTTP receive and server shutdown waits are explicitly bounded',async(t)=>{
  const f=await makeFixture();
  t.after(f.cleanup);
  const port=await freePort();
  const config={root:f.root,host:'127.0.0.1',port,mcpPath:'/mcp',healthPath:'/health',maxReadBytes:1024,stateDir:path.join(f.base,'state'),commandTimeoutMs:1000,operationTimeoutMs:100,httpRequestTimeoutMs:250,serverCloseTimeoutMs:100,maxCommandOutputBytes:4096,recycleBin:true};
  const rt=await createSparkServer(config);
  await rt.listen();
  assert.equal(rt.server.requestTimeout,250);
  assert.equal(rt.server.headersTimeout,250);
  const socket=net.createConnection({host:'127.0.0.1',port});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  socket.write('POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{');
  const started=Date.now();
  await rt.close();
  assert.ok(Date.now()-started<1000);
  socket.destroy();
});
