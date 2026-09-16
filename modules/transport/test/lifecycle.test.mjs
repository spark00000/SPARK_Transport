import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { freePort, makeFixture } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = path.join(ROOT, 'modules', 'transport', 'src', 'cli.mjs');

function run(command, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, command], { cwd: ROOT, env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (data) => out += data);
    child.stderr.on('data', (data) => err += data);
    child.on('exit', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

test('Transport start/status/stop/restart', async (t) => {
  const f = await makeFixture();
  const port = await freePort();
  const env = {
    SPARK_ROOT: f.root,
    SPARK_PORT: String(port),
    SPARK_STATE_DIR: path.join(f.base, 'state'),
    SPARK_MCP_AUTH_MODE: 'bearer',
    SPARK_MCP_BEARER_TOKEN_SHA256: crypto.createHash('sha256').update('test-lifecycle-token').digest('hex'),
  };
  t.after(async () => {
    await run('stop', env).catch(() => {});
    await f.cleanup();
  });

  let result = await run('start', env);
  assert.equal(result.code, 0, result.err);
  assert.equal(JSON.parse(result.out).status, 'started');
  result = await run('status', env);
  assert.equal(result.code, 0, result.err);
  assert.equal(JSON.parse(result.out).status, 'running');
  result = await run('stop', env);
  assert.equal(result.code, 0, result.err);
  result = await run('start', env);
  assert.equal(result.code, 0, result.err);
  result = await run('stop', env);
  assert.equal(result.code, 0, result.err);
});

test('Transport refuses unauthenticated startup', async (t) => {
  const f = await makeFixture();
  const port = await freePort();
  const env = { SPARK_ROOT:f.root, SPARK_PORT:String(port), SPARK_STATE_DIR:path.join(f.base,'state'), SPARK_MCP_AUTH_MODE:'none' };
  t.after(async()=>{await f.cleanup();});
  const result=await run('start',env);
  assert.notEqual(result.code,0);
  assert.match(result.err,/unauthenticated MCP access is forbidden|must be bearer/i);
});

test('Windows lifecycle scripts preserve help/init/start/restart/status/stop contract', async () => {
  const [cmd, init, start, stop, status, uiLauncher, uiCli, uiWatcher] = await Promise.all([
    fs.readFile(path.join(ROOT, 'SPARK.cmd'), 'utf8'),
    fs.readFile(path.join(ROOT, 'scripts', 'init-user.ps1'), 'utf8'),
    fs.readFile(path.join(ROOT, 'scripts', 'start-all.ps1'), 'utf8'),
    fs.readFile(path.join(ROOT, 'scripts', 'stop-all.ps1'), 'utf8'),
    fs.readFile(path.join(ROOT, 'scripts', 'status-all.ps1'), 'utf8'),
    fs.readFile(path.join(ROOT, 'modules', 'chatgpt-ui', 'scripts', 'start-chatgpt-ui.ps1'), 'utf8'),
    fs.readFile(path.join(ROOT, 'modules', 'chatgpt-ui', 'src', 'cli.mjs'), 'utf8'),
    fs.readFile(path.join(ROOT, 'modules', 'chatgpt-ui', 'src', 'watch.mjs'), 'utf8'),
  ]);

  assert.match(cmd, /if "%~1"=="" goto :usage/i);
  assert.match(cmd, /if \/I "%~1"=="init" goto :init/i);
  assert.match(cmd, /if \/I "%~1"=="auth" goto :auth/i);
  assert.match(cmd, /if \/I "%~1"=="restart" powershell\.exe .*stop-all\.ps1/i);
  assert.match(cmd, /if \/I "%~1"=="restart" powershell\.exe .*start-all\.ps1/i);
  assert.doesNotMatch(cmd, /goto :restart|^:restart$/im);
  assert.match(init, /auth-cli\.mjs/);
  assert.match(init, /\$authCli generate --json/);
  assert.match(init, /refusing to overwrite/i);
  assert.match(init, /UTF8Encoding.*false/);
  assert.match(init, /spark-access-key\.txt/);
  assert.match(start, /auth:none is forbidden/i);
  assert.match(start, /Test-TunnelReadyContent/);
  assert.match(start, /controlPlaneKeySha256/);
  assert.match(start, /sparkAccessKeySha256/);
  assert.match(start, /Get-StartApps/);
  assert.match(start, /modules\\transport\\config\\spark\.local\.json/);
  assert.match(start, /\.runtime\\config\\spark\.local\.json/);
  assert.match(start, /Test-Path -LiteralPath \$moduleConfig -PathType Leaf/);
  assert.match(start, /Get-Process -Name 'ChatGPT'/);
  assert.match(start, /npm run --silent transport:start/);
  assert.match(start, /bounded-process-cli\.mjs/);
  assert.match(start, /30000 \$client doctor/);
  assert.match(stop, /bounded-process-cli\.mjs/);
  assert.match(status, /npm run --silent transport:status/);
  assert.match(start, /\.StartsWith\('\[S2-08\]'\)/);
  assert.doesNotMatch(start, /-like\s+'\[S2-0[78]\]\*'/i);
  assert.match(start, /\$readyTimeoutSeconds=60/);
  assert.match(start, /tunnel-runtime\.json/);
  assert.match(start, /Get-TunnelProfileId/);
  assert.match(start, /\$runtimeIdentityOk/);
  assert.match(start, /profileTunnelId.*config\.tunnel\.id/);
  assert.match(start, /--require-control-plane-poll/);
  assert.doesNotMatch(start, /profile doctor skipped/i);
  assert.match(status, /IDENTITY-MISMATCH/);
  assert.match(status, /tunnel-runtime\.json/);
  assert.match(status, /--require-control-plane-poll/);
  assert.doesNotMatch(start, /health\?details=true/);
  assert.doesNotMatch(start, /health\/mcp/);
  assert.doesNotMatch(start, /health\/control-plane/);
  assert.match(start, /health --port 8080 --pid-file .* --require-control-plane-poll --json/);
  assert.doesNotMatch(start, /did not become ready within 20 seconds/i);
  assert.match(start, /remains running as PID/);
  assert.match(start, /Start-ChatGPTExperience/);
  assert.match(start, /modules\\chatgpt-ui\\scripts\\start-chatgpt-ui\.ps1/);
  assert.match(start, /Test-ChatGPTUiRuntime/);
  assert.match(cmd, /modules\\transport\\scripts\\validate-windows\.ps1/);
  assert.match(status, /Get-Process -Name 'ChatGPT'/);
  assert.match(status, /ChatGPT UI runtime/);
  assert.match(status, /modules\\chatgpt-ui\\\.runtime\\active\.json/);
  assert.match(stop, /\$tunnelPid\s*=/);
  assert.doesNotMatch(stop, /\$pid\s*=/i);
  assert.match(stop, /modules\\chatgpt-ui\\\.runtime\\active\.json/);
  assert.match(stop, /Stop-Process -Name|Stop-Process/);
  assert.match(uiLauncher, /--remote-debugging-port=\$port/);
  assert.match(uiLauncher, /start-chatgpt-ui|SPARK ChatGPT UI/i);
  assert.match(uiLauncher, /\[UI-01\].*Theme config validated/);
  assert.match(uiLauncher, /\[UI-06\].*startup complete/);
  assert.match(uiLauncher, /TransportHealthUrl/);
  assert.match(uiWatcher, /--transport-health/);
  assert.match(uiWatcher, /buildProgressExpression/);
  assert.match(start, /chatgptUi\.progress/);
  assert.doesNotMatch(uiLauncher, /\$result\s*\|\s*ConvertTo-Json/);
  assert.match(uiCli, /Chrome DevTools|CDP|apply|restore/i);
});

test('repository hygiene keeps local-only state out of tracked source', async () => {
  const gitignore = await fs.readFile(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /(?:^|\r?\n)_pArc\/(?:\r?\n|$)/);
  assert.match(gitignore, /(?:^|\r?\n)\.runtime\/(?:\r?\n|$)/);
  assert.match(gitignore, /(?:^|\r?\n)\.SPARK\.wiki\/?(?:\r?\n|$)/);
  assert.match(gitignore, /modules\/transport\/config\/spark\.local\.json/);
});
