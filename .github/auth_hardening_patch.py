from pathlib import Path
import re


def read(p):
    return Path(p).read_text(encoding='utf-8')


def write(p, s):
    Path(p).write_text(s, encoding='utf-8', newline='\n')


def replace_once(p, old, new):
    s = read(p)
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{p}: expected 1 occurrence, found {n}: {old[:100]!r}')
    write(p, s.replace(old, new, 1))


def replace_count(p, old, new, count):
    s = read(p)
    n = s.count(old)
    if n != count:
        raise SystemExit(f'{p}: expected {count} occurrences, found {n}: {old[:100]!r}')
    write(p, s.replace(old, new))


def replace_regex(p, pattern, repl):
    s = read(p)
    s2, n = re.subn(pattern, repl, s, flags=re.S)
    if n != 1:
        raise SystemExit(f'{p}: regex expected 1 occurrence, found {n}: {pattern[:100]!r}')
    write(p, s2)


# config: bearer-only runtime + private access-key file path
p = 'modules/transport/src/config.mjs'
replace_once(p, """function normalizeMcpAuth({ transport, env, overrides }) {
  const configured = transport.auth ?? {};
  const requestedMode = overrides.authMode ?? env.SPARK_MCP_AUTH_MODE ?? configured.mode ?? 'none';
  const mode = String(requestedMode).trim().toLowerCase();
  if (!['none', 'bearer'].includes(mode)) throw new Error('transport.auth.mode must be none or bearer');
  if (mode === 'none') return { mode: 'none', bearerTokenSha256: '' };

  const rawHash = overrides.bearerTokenSha256 ?? env.SPARK_MCP_BEARER_TOKEN_SHA256 ?? configured.bearerTokenSha256;
  if (typeof rawHash !== 'string' || !/^[0-9a-f]{64}$/i.test(rawHash.trim())) {
    throw new Error('transport.auth.bearerTokenSha256 must be a 64-character SHA-256 hex digest when bearer auth is enabled');
  }
  return { mode: 'bearer', bearerTokenSha256: rawHash.trim().toLowerCase() };
}
""", """function normalizeMcpAuth({ transport, env, overrides }) {
  const configured = transport.auth ?? {};
  const requestedMode = overrides.authMode ?? env.SPARK_MCP_AUTH_MODE ?? configured.mode;
  const mode = String(requestedMode ?? '').trim().toLowerCase();
  if (mode !== 'bearer') {
    throw new Error('transport.auth.mode must be bearer; unauthenticated MCP access is forbidden in SPARK 0.0.1');
  }

  const rawHash = overrides.bearerTokenSha256 ?? env.SPARK_MCP_BEARER_TOKEN_SHA256 ?? configured.bearerTokenSha256;
  if (typeof rawHash !== 'string' || !/^[0-9a-f]{64}$/i.test(rawHash.trim())) {
    throw new Error('transport.auth.bearerTokenSha256 must be a 64-character SHA-256 hex digest when bearer auth is enabled');
  }
  const accessKeyFile = overrides.accessKeyFile ?? env.SPARK_MCP_ACCESS_KEY_FILE ?? configured.accessKeyFile ?? '.runtime/secrets/spark-access-key.txt';
  if (typeof accessKeyFile !== 'string' || accessKeyFile.trim() === '') {
    throw new Error('transport.auth.accessKeyFile must be a non-empty path');
  }
  return { mode: 'bearer', bearerTokenSha256: rawHash.trim().toLowerCase(), accessKeyFile: accessKeyFile.trim() };
}
""")

# sample config
replace_once('modules/transport/config/spark.example.json',
             '"mode": "bearer",\n      "bearerTokenSha256": "0000000000000000000000000000000000000000000000000000000000000000"',
             '"mode": "bearer",\n      "accessKeyFile": ".runtime/secrets/spark-access-key.txt",\n      "bearerTokenSha256": "0000000000000000000000000000000000000000000000000000000000000000"')

# init: persist raw key under private secrets, digest in config
p = 'scripts/init-user.ps1'
replace_once(p,
             "$authCli=Join-Path $root 'modules\\transport\\src\\auth-cli.mjs'\nif(Test-Path -LiteralPath $ConfigPath -PathType Leaf){throw \"Config already exists; refusing to overwrite: $ConfigPath\"}",
             "$authCli=Join-Path $root 'modules\\transport\\src\\auth-cli.mjs'\n$accessKeyPath=Join-Path $root '.runtime\\secrets\\spark-access-key.txt'\nif(Test-Path -LiteralPath $ConfigPath -PathType Leaf){throw \"Config already exists; refusing to overwrite: $ConfigPath\"}\nif(Test-Path -LiteralPath $accessKeyPath -PathType Leaf){throw \"SPARK access-key secret already exists; refusing to overwrite: $accessKeyPath\"}")
replace_once(p,
             "$config.transport.auth.mode='bearer'\n$config.transport.auth.bearerTokenSha256=[string]$generated.sha256\n$directory=Split-Path -Parent $ConfigPath\nNew-Item -ItemType Directory -Force -Path $directory | Out-Null\n$json=$config | ConvertTo-Json -Depth 32\n[System.IO.File]::WriteAllText($ConfigPath,$json+[Environment]::NewLine,[System.Text.UTF8Encoding]::new($false))\nif(-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)){throw 'Config creation failed'}",
             "$config.transport.auth.mode='bearer'\n$config.transport.auth.accessKeyFile='.runtime/secrets/spark-access-key.txt'\n$config.transport.auth.bearerTokenSha256=[string]$generated.sha256\n$directory=Split-Path -Parent $ConfigPath\n$secretDirectory=Split-Path -Parent $accessKeyPath\nNew-Item -ItemType Directory -Force -Path $directory | Out-Null\nNew-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null\ntry{\n  [System.IO.File]::WriteAllText($accessKeyPath,[string]$generated.token+[Environment]::NewLine,[System.Text.UTF8Encoding]::new($false))\n  $json=$config | ConvertTo-Json -Depth 32\n  [System.IO.File]::WriteAllText($ConfigPath,$json+[Environment]::NewLine,[System.Text.UTF8Encoding]::new($false))\n}catch{\n  Remove-Item -LiteralPath $accessKeyPath -Force -ErrorAction SilentlyContinue\n  Remove-Item -LiteralPath $ConfigPath -Force -ErrorAction SilentlyContinue\n  throw\n}\nif(-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)){throw 'Config creation failed'}\nif(-not (Test-Path -LiteralPath $accessKeyPath -PathType Leaf)){throw 'SPARK access-key secret creation failed'}")
replace_once(p,
             "Write-Host '[INIT-02] PASS - 256-bit SPARK access key generated; only its SHA-256 digest was stored in config.'",
             "Write-Host '[INIT-02] PASS - 256-bit SPARK access key generated; SHA-256 digest stored in config.'\nWrite-Host '[INIT-03] PASS - Raw SPARK access key stored in private secret file:' $accessKeyPath")
replace_once(p,
             "Write-Host 'SPARK Access Key - copy this once into the ChatGPT app Access token/API key field:' -ForegroundColor Yellow",
             "Write-Host 'SPARK Access Key - enter this in ChatGPT Plugins -> SPARK -> Connect -> Enter access token or API key:' -ForegroundColor Yellow")
replace_once(p,
             "Write-Host '  3. Configure the ChatGPT custom app authentication as Access token/API key with Bearer scheme.'\nWrite-Host '  4. Paste the SPARK Access Key above into that app connection.'\nWrite-Host '  5. Run SPARK.cmd start.'",
             "Write-Host '  3. Configure/publish the ChatGPT workspace app as Access token/API key with Bearer scheme.'\nWrite-Host '  4. Each user opens Plugins -> SPARK -> Connect and enters this instance SPARK Access Key.'\nWrite-Host '  5. Run SPARK.cmd start and verify no-key/wrong-key requests are rejected.'")

# start-all: fail closed before daemon start; bind tunnel/runtime/auth identity; auth-aware readiness
p = 'scripts/start-all.ps1'
replace_once(p,
             "function Resolve-RepoRelative([string]$Value){\n  if([System.IO.Path]::IsPathRooted($Value)){return $Value}\n  return Join-Path $root $Value\n}\n",
             "function Resolve-RepoRelative([string]$Value){\n  if([System.IO.Path]::IsPathRooted($Value)){return $Value}\n  return Join-Path $root $Value\n}\n\nfunction Get-TextSha256([string]$Value){\n  $sha=[System.Security.Cryptography.SHA256]::Create()\n  try{\n    $bytes=[System.Text.Encoding]::UTF8.GetBytes($Value)\n    return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()\n  }finally{$sha.Dispose()}\n}\n\nfunction Test-TunnelReadyContent([string]$Content){\n  return ([string]$Content).Trim() -match '^ready(?:$|\\s|\\()'\n}\n")
replace_once(p,
             "Write-Host \"[S2-01] PASS - Config loaded: $ConfigPath\"\n\nWrite-Host '[S2-02] Checking Node.js...'",
             "Write-Host \"[S2-01] PASS - Config loaded: $ConfigPath\"\n\nif(-not $config.transport.auth -or [string]$config.transport.auth.mode -ne 'bearer'){Fail-Step 'S2-01A' 'transport.auth.mode must be bearer; auth:none is forbidden in SPARK 0.0.1'}\n$configuredSparkDigest=[string]$config.transport.auth.bearerTokenSha256\nif($configuredSparkDigest -notmatch '^[0-9a-fA-F]{64}$'){Fail-Step 'S2-01A' 'transport.auth.bearerTokenSha256 must be a 64-character SHA-256 digest'}\n$accessKeyFile=[string]$config.transport.auth.accessKeyFile\nif(-not $accessKeyFile){$accessKeyFile='.runtime/secrets/spark-access-key.txt'}\n$accessKeyPath=Resolve-RepoRelative $accessKeyFile\nif(-not (Test-Path -LiteralPath $accessKeyPath -PathType Leaf)){Fail-Step 'S2-01A' \"SPARK access-key secret file not found: $accessKeyPath\"}\n$accessKeyValue=(Get-Content -LiteralPath $accessKeyPath -Raw).Trim()\nif(-not $accessKeyValue){Fail-Step 'S2-01A' \"SPARK access-key secret file is empty: $accessKeyPath\"}\n$sparkAccessKeySha256=Get-TextSha256 $accessKeyValue\nif($sparkAccessKeySha256 -ne $configuredSparkDigest.ToLowerInvariant()){Fail-Step 'S2-01A' 'SPARK access-key secret does not match transport.auth.bearerTokenSha256'}\nWrite-Host \"[S2-01A] PASS - Bearer auth required; SPARK access key verified: $accessKeyPath (value hidden)\"\n\nWrite-Host '[S2-02] Checking Node.js...'")
replace_once(p,
             "$keyValue=(Get-Content -Raw $keyPath).Trim()\nif(-not $keyValue){Fail-Step 'S2-05' \"Tunnel key file is empty: $keyPath\"}\n$keyRef=\"file:$keyPath\"",
             "$keyValue=(Get-Content -Raw $keyPath).Trim()\nif(-not $keyValue){Fail-Step 'S2-05' \"Tunnel key file is empty: $keyPath\"}\n$controlPlaneKeySha256=Get-TextSha256 $keyValue\n$keyRef=\"file:$keyPath\"")
replace_count(p, "$ready.Content.Trim() -eq 'ready'", "Test-TunnelReadyContent $ready.Content", 3)
replace_once(p,
             "[string]$runtimeState.tunnelId -eq [string]$config.tunnel.id -and\n    [string]$runtimeState.profilePath -ieq [string]$profilePath -and",
             "[string]$runtimeState.tunnelId -eq [string]$config.tunnel.id -and\n    [string]$runtimeState.controlPlaneKeySha256 -eq [string]$controlPlaneKeySha256 -and\n    [string]$runtimeState.sparkAccessKeySha256 -eq [string]$sparkAccessKeySha256 -and\n    [string]$runtimeState.profilePath -ieq [string]$profilePath -and")
replace_once(p,
             "  tunnelId=[string]$config.tunnel.id\n  profile=[string]$profile",
             "  tunnelId=[string]$config.tunnel.id\n  controlPlaneKeySha256=[string]$controlPlaneKeySha256\n  sparkAccessKeySha256=[string]$sparkAccessKeySha256\n  profile=[string]$profile")

# validator: mandatory bearer, private key source, explicit missing/wrong/correct probes
p = 'modules/transport/scripts/validate-windows.ps1'
replace_once(p,
             "$authHeader=$null\nif($config.transport.auth -and [string]$config.transport.auth.mode -eq 'bearer'){\n  if(-not $env:SPARK_MCP_BEARER_TOKEN){Fail-Step 'S2V-01A' 'Bearer auth is enabled. Set SPARK_MCP_BEARER_TOKEN for this validation process.'}\n  $authHeader='Bearer '+$env:SPARK_MCP_BEARER_TOKEN\n}\n",
             "$authHeader=$null\nif(-not $config.transport.auth -or [string]$config.transport.auth.mode -ne 'bearer'){Fail-Step 'S2V-01A' 'Bearer auth is required; auth:none is forbidden'}\n$accessToken=$env:SPARK_MCP_BEARER_TOKEN\nif(-not $accessToken){\n  $accessKeyFile=[string]$config.transport.auth.accessKeyFile\n  if(-not $accessKeyFile){$accessKeyFile='.runtime/secrets/spark-access-key.txt'}\n  if(-not [System.IO.Path]::IsPathRooted($accessKeyFile)){$accessKeyFile=Join-Path $root $accessKeyFile}\n  if(-not (Test-Path -LiteralPath $accessKeyFile -PathType Leaf)){Fail-Step 'S2V-01A' \"SPARK access-key secret file not found: $accessKeyFile\"}\n  $accessToken=(Get-Content -LiteralPath $accessKeyFile -Raw).Trim()\n}\nif(-not $accessToken){Fail-Step 'S2V-01A' 'SPARK access key is empty'}\n$authHeader='Bearer '+$accessToken\n")
replace_once(p,
             "Write-Host \"[S2V-01] PASS - Config/MCP endpoint: $base\"\n$tag=",
             "Write-Host \"[S2V-01] PASS - Config/MCP endpoint: $base\"\n$probeBody=@{jsonrpc='2.0';id=99;method='tools/list';params=@{_meta=@{'io.modelcontextprotocol/protocolVersion'=$proto;'io.modelcontextprotocol/clientCapabilities'=@{};'io.modelcontextprotocol/clientInfo'=@{name='spark-auth-validator';version='1'}}}}|ConvertTo-Json -Depth 10 -Compress\n$probeHeaders=@{'MCP-Protocol-Version'=$proto;'Mcp-Method'='tools/list'}\nfunction Get-ProbeStatus([hashtable]$Headers){\n  try{return [int](Invoke-WebRequest -UseBasicParsing -Method Post -Uri $base -Headers $Headers -ContentType 'application/json' -Body $probeBody -TimeoutSec 15).StatusCode}catch{\n    if($_.Exception.Response){return [int]$_.Exception.Response.StatusCode}\n    throw\n  }\n}\n$noAuthStatus=Get-ProbeStatus $probeHeaders\nif($noAuthStatus -ne 401){Fail-Step 'S2V-01B' \"missing Authorization was not rejected; status=$noAuthStatus\"}\nWrite-Host '[S2V-01B] PASS - missing Authorization rejected with HTTP 401'\n$wrongHeaders=@{}+$probeHeaders;$wrongHeaders['Authorization']='Bearer spk_wrong_key'\n$wrongStatus=Get-ProbeStatus $wrongHeaders\nif($wrongStatus -ne 401){Fail-Step 'S2V-01C' \"wrong Authorization was not rejected; status=$wrongStatus\"}\nWrite-Host '[S2V-01C] PASS - wrong Authorization rejected with HTTP 401'\n$correctHeaders=@{}+$probeHeaders;$correctHeaders['Authorization']=$authHeader\n$correctStatus=Get-ProbeStatus $correctHeaders\nif($correctStatus -ne 200){Fail-Step 'S2V-01D' \"correct Authorization did not succeed; status=$correctStatus\"}\nWrite-Host '[S2V-01D] PASS - configured SPARK access key accepted'\n$tag=")

# lifecycle tests
p = 'modules/transport/test/lifecycle.test.mjs'
replace_once(p, "import assert from 'node:assert/strict';\n", "import assert from 'node:assert/strict';\nimport crypto from 'node:crypto';\n")
replace_once(p,
             "    SPARK_STATE_DIR: path.join(f.base, 'state'),\n  };",
             "    SPARK_STATE_DIR: path.join(f.base, 'state'),\n    SPARK_MCP_AUTH_MODE: 'bearer',\n    SPARK_MCP_BEARER_TOKEN_SHA256: crypto.createHash('sha256').update('test-lifecycle-token').digest('hex'),\n  };")
replace_once(p,
             "test('Windows lifecycle scripts preserve help/init/start/restart/status/stop contract', async () => {",
             "test('Transport refuses unauthenticated startup', async (t) => {\n  const f = await makeFixture();\n  const port = await freePort();\n  const env = { SPARK_ROOT:f.root, SPARK_PORT:String(port), SPARK_STATE_DIR:path.join(f.base,'state'), SPARK_MCP_AUTH_MODE:'none' };\n  t.after(async()=>{await f.cleanup();});\n  const result=await run('start',env);\n  assert.notEqual(result.code,0);\n  assert.match(result.err,/unauthenticated MCP access is forbidden|must be bearer/i);\n});\n\ntest('Windows lifecycle scripts preserve help/init/start/restart/status/stop contract', async () => {")
replace_once(p,
             "  assert.match(init, /UTF8Encoding.*false/);",
             "  assert.match(init, /UTF8Encoding.*false/);\n  assert.match(init, /spark-access-key\\.txt/);\n  assert.match(start, /auth:none is forbidden/i);\n  assert.match(start, /Test-TunnelReadyContent/);\n  assert.match(start, /controlPlaneKeySha256/);\n  assert.match(start, /sparkAccessKeySha256/);")

# README installation flow
p = 'README.md'
replace_regex(p, r"### Step 3 — Private config \+ SPARK Access Key 초기화.*?(?=### Step 4 — Tunnel Runtime API key 저장)", """### Step 3 — Private config + SPARK Access Key 초기화

신규 설치는 먼저 한 번 실행합니다.

```cmd
SPARK.cmd init
```

`init`은 기존 private config나 기존 access-key secret을 덮어쓰지 않습니다. Node.js `crypto.randomBytes(32)` / OS CSPRNG로 256-bit per-instance SPARK Access Key를 만들고 다음 두 위치에 분리 저장합니다.

- raw `spk_...` key: `.runtime/secrets/spark-access-key.txt`
- SHA-256 digest: `.runtime/config/spark.local.json`의 `transport.auth.bearerTokenSha256`

config의 `transport.auth.accessKeyFile`은 기본적으로 `.runtime/secrets/spark-access-key.txt`를 가리킵니다. `.runtime/` 전체는 Git에서 제외됩니다. 시작 시 SPARK는 secret file의 실제 key를 다시 SHA-256하여 config digest와 일치하는지 확인하고, 일치하지 않거나 auth가 `bearer`가 아니면 **startup을 fail closed**합니다.

```cmd
notepad .runtime\\config\\spark.local.json
```

최소 수정 항목:

- `transport.allowedRoot`: SPARK가 접근할 local root
- `transport.auth.mode`: **반드시 `bearer`** (`none` 금지)
- `transport.auth.accessKeyFile`: 기본 `.runtime/secrets/spark-access-key.txt`
- `tunnel.id`: 이 사용자/PC 전용 Tunnel ID
- `tunnel.controlPlaneApiKeyFile`: 기본 `.runtime/secrets/control-plane-api-key.txt`
- `chatgptUi.enabled`, `chatgptUi.theme`, `chatgptUi.progress.enabled`

Windows JSON path는 `C:/SPARK/...`처럼 `/` 표기를 권장합니다.

""")
replace_regex(p, r"### Step 4A — 0\.0\.1 per-instance deployment notes.*?(?=### Step 5 — SPARK 시작)", """### Step 4A — 0.0.1 instance identity / secret binding

```text
1 local SPARK instance
= 1 tunnel_id
+ 1 OpenAI Tunnel Runtime API key (control-plane key)
+ 1 SPARK Access Key (spk_...)
```

`tunnel_id`가 workspace UI에 보이더라도 `spk_...` key가 일치하지 않으면 local MCP는 HTTP 401로 거부합니다. SPARK runtime identity state에는 raw secret이 아니라 tunnel ID, tunnel Runtime key SHA-256, SPARK Access Key SHA-256, tunnel profile SHA-256을 기록하여 기존 tunnel process 재사용 시 동일 조합인지 확인합니다. `auth:none`은 0.0.1 runtime에서 허용하지 않습니다.

""")
replace_regex(p, r"### Step 7 — ChatGPT custom MCP app 등록.*?(?=#### Create / Scan Tools가 실패할 때)", """### Step 7 — ChatGPT workspace App publish + 사용자별 Access Key Connect

**중요: SPARK Access Key는 App 생성 화면에 입력하는 것이 아닙니다.** 현재 ChatGPT Business UI에서 검증된 순서는 아래와 같습니다.

#### A. Workspace admin/developer — App 정의 및 Publish

1. ChatGPT developer mode를 활성화합니다.
2. Apps/Create에서 custom App을 만들고 이름을 **`SPARK`**로 지정합니다.
3. Connection은 **Tunnel**을 선택하고 이 SPARK instance의 `tunnel_id`를 선택/입력합니다.
4. Authentication은 **`Access token / API key`** 를 선택합니다.
5. Header scheme은 **`Bearer`** 를 선택합니다.
6. App을 Workspace에 **Publish**합니다.

#### B. 각 사용자 — Plugins 화면에서 자기 `spk_...` key 입력

1. 사용자 ChatGPT에서 **Plugins → SPARK**를 엽니다.
2. **Connect**를 누릅니다.
3. 표시되는 **`Enter access token or API key`** 입력칸에 그 사용자의 local SPARK instance에 대응하는 `spk_...` 값을 입력합니다.
   - `Bearer ` 문자열은 붙이지 않습니다.
4. **Connect SPARK**를 누릅니다.
5. App detail에서 **Actions · 10**이 표시되는지 확인합니다.
6. Configure actions에서 Refresh가 필요하면 연결 완료 후 Refresh합니다. 연결되지 않은 상태에서는 `This app must be connected to refresh its actions.`가 표시될 수 있습니다.
7. 새 Chat에서 SPARK tool 10개가 discovery되는지 확인합니다.

즉 Workspace App 정의는 공유될 수 있지만 **connection credential은 각 사용자가 Plugins → SPARK → Connect 단계에서 따로 입력**합니다. 다른 팀원이 같은 `tunnel_id`를 볼 수 있어도 local SPARK의 per-instance `spk_...`가 없으면 요청은 401이어야 합니다.

""")

# ARCH 10.7
p = 'docs/ARCH.md'
replace_regex(p, r"### 10\.7\. 0\.0\.1 Intermediate Multi-user Deployment — Per-user Tunnel \+ Local Authorization.*?(?=### 10\.8\.)", """### 10.7. 0.0.1 Multi-user Deployment — Shared Workspace App, Per-instance Tunnel/Auth

Verified ChatGPT Business flow (2026-09-16):

```text
Workspace admin/developer
  -> create SPARK App
  -> Connection = Tunnel
  -> Authentication = Access token / API key
  -> Header scheme = Bearer
  -> Publish to Workspace

Each user
  -> ChatGPT Plugins -> SPARK -> Connect
  -> "Enter access token or API key"
  -> enter that local instance's spk_... key
  -> ChatGPT sends Authorization: Bearer <spk_...>
  -> Secure MCP Tunnel forwards Authorization
  -> local SPARK validates SHA-256(token)
```

The access key is **not entered in the App creation form**. It is entered by each user on the published Plugin's **Connect** screen. This live flow was followed by successful discovery of `Actions · 10` and the 10-tool SPARK surface in a new chat.

Security invariant:

```text
1 local SPARK instance
= 1 tunnel_id
+ 1 Tunnel Runtime/control-plane key
+ 1 SPARK Access Key (spk_...)
```

- A tunnel ID is routing metadata, not sufficient authorization. Workspace members may be able to see/select other tunnels.
- Tunnel Runtime key authenticates the local tunnel-client to OpenAI; SPARK Access Key authorizes MCP requests at the local SPARK boundary.
- `transport.auth.mode=bearer` is mandatory. `auth:none` is rejected fail-closed.
- Raw SPARK Access Key is private `.runtime/secrets/spark-access-key.txt`; config stores only its SHA-256 digest and path. Startup verifies raw-secret/digest consistency.
- Runtime identity binds tunnel ID, control-plane-key SHA-256, SPARK-access-key SHA-256 and profile SHA-256; process reuse requires the same instance identity.
- Missing/wrong `Authorization: Bearer ...` returns HTTP 401; matching key is required for tool access.
- Workspace App definition may be shared; connection credential is entered per user at Plugins → SPARK → Connect.
- OAuth/OIDC and a central payload relay remain deferred for the small-team 0.0.1 scope.
- same-PC hostile-process isolation remains TBD.

""")

# QGate
p = 'docs/ARCH_QGate.md'
replace_once(p,
             "| ChatGPT `Access token / API key` own-key success / foreign-key denial | **PENDING final multi-user gate** |",
             "| ChatGPT published Plugin user-connect credential UI | PASS — Plugins → SPARK → Connect exposes `Enter access token or API key`; per-user `spk_...` entry verified |\n| ChatGPT action discovery after Connect | PASS — App detail shows `Actions · 10`; new chat exposes 10 SPARK tools |\n| `auth:none` production startup prohibition | PASS — source/config gate added; live restart acceptance pending |\n| ChatGPT own-key success / missing-key + foreign-key denial with local bearer enforcement enabled | **PENDING final multi-user gate** |")
replace_once(p,
             "- ChatGPT custom app configured as `Access token / API key` + Bearer succeeds with its own SPARK instance key and fails with another instance key.",
             "- published ChatGPT Plugin is connected per user through Plugins → SPARK → Connect → `Enter access token or API key`.\n- local runtime refuses `auth:none`; missing/wrong bearer returns 401; the connected user's matching key succeeds.")
replace_once(p,
             "- **DEPLOY-001:** 0.0.1 uses one distinct Secure MCP Tunnel and one high-entropy bearer credential per SPARK instance. It intentionally has no SPARK-operated central payload relay or OAuth service.",
             "- **DEPLOY-001:** 0.0.1 binds one local instance to one tunnel ID + one Tunnel Runtime/control-plane key + one high-entropy SPARK bearer credential. Tunnel visibility/routing alone never authorizes local MCP access. It intentionally has no SPARK-operated central payload relay or OAuth service.")
replace_once(p,
             "**0.0.1 source-level release-candidate gate: PASS locally; cross-platform CI, integrated runtime recovery, and live Windows `SPARK.cmd validate` are PASS. The only remaining release blocker is the user-scoped ChatGPT Bearer own-key/wrong-key E2E.**",
             "**0.0.1 source-level release-candidate gate: user-scoped ChatGPT Connect UI and 10-action discovery are verified. The remaining release blocker is live enforcement after hardening: auth:none startup must fail, missing/wrong key must return 401, and the connected user's matching key must succeed.**")

print('auth hardening patch applied')
