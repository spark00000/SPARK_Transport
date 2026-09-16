# ARCH QGate — SPARK 0.0.1 Release Candidate

**Target:** 0.0.1 multi-user / deployment release candidate
**Inherited baseline:** `v0.0.0` private-use baseline
**Review date:** 2026-09-16
**Review type:** Author self-check + automated evidence — **independent peer review 아님**

| 항목 | 결과 |
|---|---|
| 0.0.0 Brain Gateway / Agent Core / Body Port separation | PASS — inherited |
| MCP standard / no proprietary protocol extension | PASS |
| 10-tool CRUD/process surface unchanged | PASS |
| traversal / absolute / symlink / Windows junction containment | PASS |
| write/modify recovery + Windows Recycle Bin / no permanent fallback | PASS |
| command output bound + process-tree timeout cleanup | PASS |
| synchronous command/tool/request/lifecycle waits bounded | PASS |
| timed-out mutation `stateUncertain` + overlapping mutation fail-closed | PASS |
| per-instance Bearer authorization positive/negative regression | PASS |
| raw SPARK access key excluded from config; only SHA-256 digest stored | PASS |
| raw SPARK access key private file | PASS — `.runtime/secrets/spark-access-key.txt`; startup verifies file digest against config |
| access-key generator = 32 CSPRNG bytes / 256 bits | PASS |
| `SPARK init` refuses existing config/access-key secret overwrite | PASS |
| new-install example config uses fail-closed bearer placeholder | PASS |
| instance identity binding | PASS — tunnel ID + Tunnel Runtime-key SHA-256 + SPARK-key SHA-256 + profile SHA-256 |
| central SPARK payload relay absent | PASS |
| ChatGPT UI progress overlay source regression | PASS |
| ChatGPT Windows DOM progress experiment | PASS — sidebar top/bottom panels remain visible without covering Search/Update; Brain/SPARK states update live |
| popup-free provider usage telemetry | PASS — authenticated ChatGPT Desktop background `GET /wham/usage` source read without opening the Usage popup; live values `5H 100%`, `WK 76%` matched the provider popup |
| provider-usage failure behavior | PASS — 30-second cache/fail-soft refresh with local/model/chat fallback; no fabricated quota values |
| ChatGPT UI PowerShell-BOM runtime JSON compatibility | PASS |
| tunnel-readiness console progress suppression | PASS — PowerShell web-request progress UI hidden while polling/watchdogs remain active |
| auth-aware tunnel readiness | PASS — `ready (mcp initialize requires auth: ...)` accepted as ready rather than timing out |
| `SPARK.cmd restart` label simplification | PASS — recursive `call`/`:restart` dependency removed; direct stop → start lifecycle path |
| private config/runtime excluded from Git | PASS |
| tracked `.gitignore` excludes `_pArc/`, `.runtime/`, `.SPARK.wiki`, private config without local-exclude dependency | PASS |
| auth-hardening Node regression | PASS — head `e001537cbf80cb7a71595d49b6a9d4a05c1efb8e`; 48 tests / 46 pass / 2 platform skips / 0 fail |
| `auth:none` production startup prohibition | PASS — automated regression proves startup failure |
| ChatGPT UI validate | PASS — candidate source |
| PowerShell parser gate | PASS — previous candidate; final Windows CI recheck pending this docs checkpoint |
| integrated 0.0.1 runtime stop/start + Transport/Tunnel/ChatGPT UI recovery | PASS — pre-hardening runtime; post-hardening live acceptance pending |
| Windows live `SPARK.cmd validate` after restart onto active 0.0.1 source | **PENDING post-hardening rerun** — must prove missing/wrong key 401 and correct key success |
| ChatGPT published Plugin user-connect credential UI | PASS — Plugins → SPARK → Connect exposes `Enter access token or API key`; per-user `spk_...` entry verified |
| ChatGPT action discovery after Connect | PASS — App detail shows `Actions · 10`; new chat exposes 10 SPARK tools |
| ChatGPT own-key success / missing-key + foreign-key denial with local bearer enforcement enabled | **PENDING final multi-user gate** |
| Ubuntu Node 24 CI on usage-overlay code head `f8a9972` | PASS — run `35020324238` |
| Windows Node 24 CI on usage-overlay code head `f8a9972` | PASS — run `35020324238` |
| ProcessService filesystem/network confinement outside FileService roots | **TBD / KNOWN GAP** — current `X` gates cwd only; child authority remains ambient OS-user authority |
| hostile process on the same local PC calling loopback SPARK | **TBD** — explicitly outside 0.0.1 remote/workspace-user isolation scope |
| Independent Architecture Peer | PENDING — process gate |

## 1. 0.0.1 Acceptance Evidence

Candidate acceptance requires all of the following before the final `v0.0.1` tag is created or moved:

- package/runtime/launcher version all report `0.0.1`.
- `npm test` full regression PASS.
- `npm run chatgpt-ui:validate` PASS.
- PowerShell lifecycle/parser PASS.
- tracked repository hygiene/privacy/secret check PASS.
- `SPARK auth generate` produces a 256-bit prefixed token and a matching SHA-256 digest.
- `SPARK init` creates a new private config/access-key secret but refuses to overwrite existing state.
- runtime startup requires `transport.auth.mode=bearer` and a matching private access-key secret/digest.
- bearer-auth MCP requests reject missing/wrong keys and accept the configured instance key.
- watchdog regressions prove tool/request/lifecycle control returns within declared bounds.
- experimental progress UI renders on the real ChatGPT Windows DOM and remains removable/recoverable.
- after runtime restart, Windows `SPARK.cmd validate` PASS on the hardened 0.0.1 source.
- published ChatGPT Plugin is connected per user through Plugins → SPARK → Connect → `Enter access token or API key`.
- local runtime refuses `auth:none`; missing/wrong bearer returns 401; the connected user's matching key succeeds.
- GitHub Actions Ubuntu Node 24 PASS.
- GitHub Actions Windows Node 24 PASS.

Exact candidate SHA, CI run IDs and final live runtime acceptance belong in local-only `_pArc/SWE3.md`.

## 2. Findings / Debt

- **DEBT-001:** Native Windows Job Object remains the preferred stronger long-term process-ownership backend.
- **DEBT-002 / TBD:** `run_command` cwd containment is not an OS filesystem/network sandbox. If a root grants `X`, the launched process may access other locations allowed by the ambient OS account. FileService R/W and Recycle Bin semantics do not constrain arbitrary child-process I/O. Provider-native ProcessService confinement remains deferred.
- **DEBT-003 / RESEARCH:** Cygwin remains only a possible Windows POSIX/ACL File/Permission PAL helper; it is not a ProcessService sandbox.
- **DEBT-004 / TBD:** same-PC hostile local-process isolation remains deferred; 0.0.1 prioritizes remote/workspace-user cross-access prevention.
- **DEPLOY-001:** 0.0.1 binds one local instance to one tunnel ID + one Tunnel Runtime/control-plane key + one high-entropy SPARK bearer credential. Tunnel visibility/routing alone never authorizes local MCP access. It intentionally has no SPARK-operated central payload relay or OAuth service.
- **DEPLOY-002:** raw SPARK access key lives only under private runtime secrets; normal config stores its SHA-256 digest and path. Manual generation/rotation remains possible with `SPARK auth generate`.
- **UX-001 / EXPERIMENTAL:** Brain working indication is a ChatGPT DOM heuristic and may require adaptation when the provider UI changes. SPARK watchdog progress is measured locally. ChatGPT quota telemetry currently reuses the provider's authenticated internal `/wham/usage` client/query and therefore may break when the desktop app changes; it must fail soft and never fabricate quota values. The usage integration is UX-only and is not part of the Agent Core or authorization boundary.
- **PROCESS-001:** Independent Architecture Peer review has not been executed in this authoring context.

## 3. Gate Conclusion

**0.0.1 source hardening is regression-clean and the user-scoped ChatGPT Connect UI/10-action discovery are verified. Remaining release blockers are the normal Ubuntu/Windows CI recheck on the hardened head and live Windows enforcement: auth:none startup must fail, missing/wrong key must return 401, and the connected user's matching key must succeed.**

This is **not yet the final 0.0.1 baseline** and does not authorize creating/moving `v0.0.1` until those gates pass. ProcessService filesystem/network confinement and same-PC hostile-process isolation remain explicit deferred gaps rather than implied guarantees.
