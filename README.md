# SPARK — Symbiotic Personal AI Robotic Keeper

<p align="center">
  <img src="docs/spark_icon2.png" alt="SPARK — Symbiotic Personal AI Robotic Keeper" width="900">
</p>

> **Agent quick start:** 이 README의 `Installation` 절을 위에서 아래로 그대로 실행하면 새 Windows PC에서 SPARK 0.0.1 multi-user / deployment release candidate을 설치하고 ChatGPT custom MCP app까지 등록할 수 있습니다.

SPARK는 **Symbiotic Personal AI Robotic Keeper**의 약자입니다. 현재 0.0.1은 ChatGPT를 OpenAI Secure MCP Tunnel로 Windows PC의 SPARK Transport에 연결하여 local filesystem CRUD와 simple command execution을 표준 MCP로 제공합니다. ChatGPT Windows app에는 CDP 기반 ChatGPT UI theme runtime이 함께 포함됩니다.

현재 release는 **version 0.0.1 — Private Usage Baseline**입니다.

## 1. Architecture

현재 동작 경로는 다음과 같습니다.

```text
ChatGPT Web/App
  -> OpenAI Secure MCP Tunnel
  -> MCP 2026-07-28
  -> SPARK Transport
  -> Windows Filesystem / Process / Recycle Bin
```

ChatGPT Windows app UI는 별도의 local module이 담당합니다.

```text
SPARK/
├─ modules/
│  ├─ transport/     # MCP, policy, filesystem/process execution, tunnel support
│  └─ chatgpt-ui/    # ChatGPT Windows UI theme/CDP integration
├─ .runtime/         # local-only config, secret, PID, profile, ledger/recovery
├─ docs/             # architecture / quality gate
├─ scripts/          # start-all / status-all / stop-all
└─ SPARK.cmd
```

자세한 내부 구조는 `docs/ARCH.md`와 `docs/ARCH_QGate.md`에 있습니다.

## 2. MCP Tools

MCP baseline은 `2026-07-28`이며 SPARK 전용 protocol extension은 만들지 않습니다.

| Tool | 기능 |
|---|---|
| `list_directory` | directory 목록 |
| `read_file` | UTF-8 파일 읽기 |
| `create_file` | 새 파일 생성 |
| `write_file` | recovery backup 후 파일 전체 교체 |
| `modify_file` | 정확히 한 번 나타나는 text 부분 치환 |
| `create_directory` | directory 생성 |
| `copy_path` | 파일/폴더 복사 |
| `move_path` | 파일/폴더 이동/rename |
| `delete_path` | **Windows Recycle Bin**으로 이동 |
| `run_command` | non-elevated simple command 실행 |

모든 tool invocation은 normalized result와 unique operation ID를 반환하고 local JSONL operation ledger에 기록됩니다.

## 3. Result / Operation Ledger

Result envelope의 핵심 fields:

```text
ok
operationId
operation
summary
changed
data
durationMs
requiresElevation
retryable
error?
```

`SPARK.cmd status`는 Transport/Tunnel/ChatGPT/ChatGPT UI 상태만 간결하게 표시합니다. 상세 operation history는 local JSONL ledger에 유지하며 정상 startup/status console에는 전체 JSON payload를 출력하지 않습니다.

`ledger/`와 `recovery/`는 배포 파일이 아니라 runtime state입니다. 둘 다 사전에 존재할 필요가 없으며 실제 operation 기록 또는 recoverable write/modify가 발생할 때 `stateDir` 아래에 자동 생성됩니다. 현재 private-use config는 `stateDir`을 `.runtime`으로 지정하며, `.runtime/` 전체는 Git에서 제외됩니다. `SPARK_STATE_DIR`로 test/development override가 가능합니다.

## 4. Installation

이 절은 **새 Windows PC에서 SPARK 0.0.1을 처음 설치하는 순서**입니다. 위에서 아래로 그대로 진행합니다.

### Step 0 — Prerequisite

필수 조건:

- Windows 11
- Git
- Node.js 20 이상 (`Node 24` CI 검증)
- ChatGPT Business / Enterprise / Edu에서 custom MCP app을 만들 수 있는 권한
- OpenAI Platform에서 Secure MCP Tunnel을 만들거나 사용할 수 있는 권한

### Step 1 — OpenAI Secure MCP Tunnel 준비

SPARK를 clone하기 전에 Tunnel ID와 Runtime API key를 먼저 준비합니다.

1. OpenAI Platform의 Tunnels 관리 화면을 엽니다.
   - https://platform.openai.com/settings/organization/tunnels
2. 새 tunnel을 만들거나 기존 tunnel을 선택하고 **tunnel ID**를 기록합니다.
   - 형식: `tunnel_...`
   - ChatGPT에서 사용할 workspace에 tunnel access가 있어야 합니다.
3. Runtime API keys 화면을 엽니다.
   - https://platform.openai.com/settings/organization/api-keys
4. Runtime key를 **Restricted**로 만들고 **Tunnels Read + Use** 권한을 부여합니다.
   - 장시간 실행되는 SPARK runtime에는 Admin key를 사용하지 않습니다.
5. 새 tunnel을 방금 생성했다면 약 **25–30초** 뒤 active/ready 상태를 확인합니다.

SPARK는 이후 `SPARK.cmd start`에서 필요한 `tunnel-client.exe` 다운로드, SHA-256 검증, profile 생성, `doctor`, `run`을 자동으로 수행합니다. 사용자가 tunnel-client profile을 수동으로 만들 필요는 없습니다.

### Step 2 — SPARK clone 및 version 확인

```cmd
git clone https://github.com/spark00000/SPARK.git
cd SPARK
node --version
npm --version
node -p "require('./package.json').version"
```

마지막 출력은 `0.0.1`이어야 합니다.

### Step 3 — Private config + SPARK Access Key 초기화

신규 설치는 먼저 한 번 실행합니다.

```cmd
SPARK.cmd init
```

`init`은 기존 private config나 기존 access-key secret을 덮어쓰지 않습니다. Node.js `crypto.randomBytes(32)` / OS CSPRNG로 256-bit per-instance SPARK Access Key를 만들고 다음 두 위치에 분리 저장합니다.

- raw `spk_...` key: `.runtime/secrets/spark-access-key.txt`
- SHA-256 digest: `.runtime/config/spark.local.json`의 `transport.auth.bearerTokenSha256`

config의 `transport.auth.accessKeyFile`은 기본적으로 `.runtime/secrets/spark-access-key.txt`를 가리킵니다. `.runtime/` 전체는 Git에서 제외됩니다. 시작 시 SPARK는 secret file의 실제 key를 다시 SHA-256하여 config digest와 일치하는지 확인하고, 일치하지 않거나 auth가 `bearer`가 아니면 **startup을 fail closed**합니다.

```cmd
notepad .runtime\config\spark.local.json
```

최소 수정 항목:

- `transport.allowedRoot`: SPARK가 접근할 local root
- `transport.auth.mode`: **반드시 `bearer`** (`none` 금지)
- `transport.auth.accessKeyFile`: 기본 `.runtime/secrets/spark-access-key.txt`
- `tunnel.id`: 이 사용자/PC 전용 Tunnel ID
- `tunnel.controlPlaneApiKeyFile`: 기본 `.runtime/secrets/control-plane-api-key.txt`
- `chatgptUi.enabled`, `chatgptUi.theme`, `chatgptUi.progress.enabled`

Windows JSON path는 `C:/SPARK/...`처럼 `/` 표기를 권장합니다.

### Step 4 — Tunnel Runtime API key 저장

```cmd
mkdir .runtime\secrets 2>NUL
notepad .runtime\secrets\control-plane-api-key.txt
```

파일에는 Step 1에서 만든 **OpenAI Tunnel Runtime API key 한 줄만** 저장합니다. `.runtime/`은 Git에 포함되지 않습니다.

### Step 4A — 0.0.1 instance identity / secret binding

```text
1 local SPARK instance
= 1 tunnel_id
+ 1 OpenAI Tunnel Runtime API key (control-plane key)
+ 1 SPARK Access Key (spk_...)
```

`tunnel_id`가 workspace UI에 보이더라도 `spk_...` key가 일치하지 않으면 local MCP는 HTTP 401로 거부합니다. SPARK runtime identity state에는 raw secret이 아니라 tunnel ID, tunnel Runtime key SHA-256, SPARK Access Key SHA-256, tunnel profile SHA-256을 기록하여 기존 tunnel process 재사용 시 동일 조합인지 확인합니다. `auth:none`은 0.0.1 runtime에서 허용하지 않습니다.

### Step 5 — SPARK 시작

```cmd
SPARK.cmd start
SPARK.cmd status
```

정상 상태:

```text
Transport service : running / healthy
Tunnel            : ready
ChatGPT            : running
ChatGPT UI         : active
```

Tunnel이 ready가 아니면 먼저 `SPARK.cmd status`와 `.runtime/tunnel-doctor.log`를 확인합니다. 새 tunnel은 생성 직후 약 25–30초의 activation 시간이 필요할 수 있습니다.

`start`는 ready 응답만으로 기존 tunnel-client를 재사용하지 않습니다. 현재 config의 `tunnel.id`, generated profile의 `tunnel_id`, PID/runtime identity state와 profile SHA-256이 모두 일치하고 Control Plane poll까지 성공한 경우에만 기존 process를 재사용합니다. ID/profile mismatch가 발견되면 기존 profile을 `.runtime/tunnel-profile-backups/`에 hash 검증된 recovery copy로 보존한 뒤 현재 config 기준으로 profile을 재생성하고 tunnel-client를 다시 시작합니다.

### Step 6 — Local validation

```cmd
npm test
npm run chatgpt-ui:validate
SPARK.cmd validate
```

모든 명령이 PASS해야 합니다.

### Step 7 — ChatGPT workspace App publish + 사용자별 Access Key Connect

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

#### Create / Scan Tools가 실패할 때

**local MCP server가 잘못됐다고 바로 판단하지 마십시오.** SPARK app 생성 과정은 Transport뿐 아니라 Secure MCP Tunnel의 Control Plane 인증/권한과 workspace 연결이 모두 정상이어야 합니다.

먼저 다음을 확인합니다.

```cmd
SPARK.cmd status
.\modules\transport\tools\tunnel-client\tunnel-client.exe health --port 8080 --pid-file .runtime\tunnel-client.pid --require-control-plane-poll --json
```

정상 기준:

```text
Tunnel: ready (identity=verified, ..., control-plane=ok)
health result: ok
control_plane_poll.ok: true
```

`/readyz`만 `ready`라고 해서 충분하지 않습니다. Runtime API key는 대상 tunnel에 대해 **Tunnels Read + Use** 권한이 있어야 하고, 해당 tunnel은 ChatGPT에서 사용하는 workspace에 연결되어 있어야 합니다. `403` polling 또는 `control_plane_poll.ok=false`이면 MCP protocol을 수정하기 전에 key 권한, tunnel ID, workspace 연결을 먼저 확인합니다. 새 tunnel은 생성 직후 약 25–30초 activation 시간이 필요할 수 있습니다.

이번 1.4 과정에서 실제로 혼동을 일으켰던 오류도 구분해서 봐야 합니다.

- `MCP SSE probe returned 404 from openai.org`: OpenAI `tunnel-client` issue #35에서 같은 증상이 보고됐습니다. 그중 Windows 재현 하나는 Runtime API key가 `401 Unauthorized`로 거부되어 **Control Plane poll이 한 번도 성공하지 않은 상태**가 원인이었고, key를 바로잡아 `control_plane_poll.ok=true`가 되자 이 증상은 사라졌습니다. 따라서 이 오류가 보이면 SPARK에 SSE endpoint를 임의로 추가하기 전에 Control Plane poll부터 확인합니다. https://github.com/openai/tunnel-client/issues/35
- `MCP server/discover response was inconsistent from openai.org` / HTTP 424: OpenAI `tunnel-client` issue #63은 v0.0.14의 **embedded MCP stub**이 modern stateless `2026-07-28` discovery를 올바르게 처리하지 못한 별도 문제였습니다. OpenAI는 source `master`에서 이를 수정했지만 해당 issue 종료 시점의 published v0.0.14에는 fix가 포함되지 않았다고 명시했습니다. SPARK는 embedded stub이 아니라 자체 HTTP MCP server가 `2026-07-28` `server/discover`/`tools/list`/`tools/call`을 직접 구현하므로 같은 오류 문자열만으로 SPARK server bug라고 단정하지 않습니다. https://github.com/openai/tunnel-client/issues/63

SPARK가 사용하는 현재 profile은 **Bearer-protected local MCP + Secure MCP Tunnel**입니다. 별도의 local MCP OAuth를 요구하지 않습니다. 다만 ChatGPT app 자체가 인증/권한 prompt를 표시하는 경우에는 해당 인증을 완료한 뒤 `Scan Tools`를 다시 실행해야 합니다.

#### `@SPARK`가 보이는데 tool을 사용할 수 없을 때

ChatGPT에서 app이 목록에 보이는 것과 **현재 message에 app tool schema가 실제 선택/주입된 것**은 같은 의미가 아닙니다.

1. 해당 message에서 Plugins/Apps 메뉴의 **`SPARK`**를 실제로 선택하거나 `@SPARK` mention을 붙입니다.
2. 인증/권한 prompt가 있으면 먼저 완료합니다.
3. 새 data/tool call이 필요한 후속 message에서는 필요하면 `@SPARK`를 다시 선택합니다.
4. 그 뒤 Actions가 정확히 10개인지 확인합니다.

1.4 acceptance에서도 처음에는 `SPARK` app이 UI에 보였지만 현재 turn에 namespace가 주입되지 않았고, **authorized `@SPARK` selection 후 정확히 10개 Actions가 노출되어 E2E가 성공**했습니다. 따라서 이 증상만 보고 SPARK Transport가 tool을 제공하지 못한다고 판단하지 않습니다.

### Step 8 — ChatGPT smoke test

새 `SPARK` app을 선택한 chat에서 다음을 확인합니다.

1. Actions가 정확히 10개인지 확인
2. `list_directory` 또는 `read_file` 성공
3. test-only file에 대한 `create_file` / `write_file` 성공
4. `run_command` simple command 성공
5. mutation test artifact는 `delete_path`로 Windows Recycle Bin에 정리

현재 repository의 branding assets:

- `docs/spark_icon1.png` — 256×256 app icon, 10 KB 미만
- `docs/spark_icon2.png` — README/GitHub banner
- `docs/spark_icon3.png` — large square artwork

## 5. Lifecycle

Repository root에서 사용합니다.

```cmd
SPARK.cmd          rem help
SPARK.cmd start
SPARK.cmd status
SPARK.cmd restart
SPARK.cmd stop
SPARK.cmd validate
```

- `start`: Transport → Secure MCP Tunnel → ChatGPT UI 순서로 시작
- `status`: Transport, Tunnel, ChatGPT, ChatGPT UI 상태 표시
- `restart`: 전체 runtime 재시작
- `stop`: tunnel-client, Transport, ChatGPT UI watcher, ChatGPT 종료
- `validate`: Windows Transport CRUD/command/Recycle Bin 검증

## 6. Current Security Behavior

### Filesystem

- allowed root 밖 경로 차단
- `..` traversal 차단
- symlink / NTFS junction escape 차단
- Root 자체 삭제 금지
- multi-root에서 같은 상대경로가 둘 이상의 Root에 있으면 `AMBIGUOUS_ROOT_PATH`
- `delete_path`는 Windows Recycle Bin 사용
- Recycle Bin 실패 시 permanent-delete fallback 없음

### Command execution

`run_command`는:

- current-user / non-elevated 실행
- explicit executable + argv
- allowed root 내부 cwd 요구
- timeout + child process-tree cleanup
- bounded stdout/stderr
- exit code/signal/duration 반환

**cwd confinement은 OS filesystem sandbox가 아닙니다.** 실행한 process는 현재 Windows 사용자 권한을 가집니다.

## 7. Runtime State

`.runtime/`은 machine-local이며 Git에 포함되지 않습니다.

현재 사용되는 항목:

```text
.runtime/
├─ config/             # spark.local.json
├─ secrets/            # tunnel Runtime API key
├─ tunnel-profiles/    # generated tunnel-client profile
├─ ledger/             # operation 발생 시 자동 생성
├─ recovery/           # recoverable mutation 시 자동 생성
├─ spark.log           # Transport log
├─ spark.pid
├─ tunnel-client.pid
├─ tunnel-runtime.json # active tunnel ID/profile hash/PID identity state
└─ tunnel-doctor.log   # tunnel doctor 실행 시 생성
```

`ledger/`와 `recovery/`는 clone/package에 없어도 정상이며 필요할 때 자동 생성됩니다.

## 8. Validation

```cmd
npm test
npm run chatgpt-ui:validate
SPARK.cmd validate
```

0.0.1 release-candidate source는 GitHub Actions에서 Node 24 기준 Windows와 Ubuntu regression을 통과했습니다.

## 9. Current Repository Layout

```text
SPARK/
├─ modules/
│  ├─ transport/
│  │  ├─ config/
│  │  ├─ scripts/
│  │  ├─ src/
│  │  ├─ test/
│  │  └─ tools/
│  └─ chatgpt-ui/
│     ├─ config/
│     ├─ scripts/
│     ├─ src/
│     └─ test/
├─ .runtime/           # local-only, clone에는 없음
├─ docs/
├─ scripts/            # start-all/status-all/stop-all
├─ SPARK.cmd
└─ package.json
```

## 10. Baseline

- Version: **0.0.1** (release candidate until final bearer-key E2E + CI gate)
- Name: **SPARK — Symbiotic Personal AI Robotic Keeper**
- Current Brain path: **ChatGPT → Secure MCP Tunnel → SPARK Transport**
- Current Windows UI integration: **ChatGPT UI CDP theme runtime**
- MCP actions: **10**
- private config, secrets, PID/profile, ledger/recovery는 tracked source에 포함되지 않습니다.