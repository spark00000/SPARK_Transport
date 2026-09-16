param([string]$ConfigPath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$boundedProcess=Join-Path $root 'modules\transport\src\bounded-process-cli.mjs'

function Fail-Step([string]$Id,[string]$Message){
  Write-Host "[$Id] FAIL - $Message" -ForegroundColor Red
  throw "[$Id] $Message"
}

function Resolve-RepoRelative([string]$Value){
  if([System.IO.Path]::IsPathRooted($Value)){return $Value}
  return Join-Path $root $Value
}

function Get-TextSha256([string]$Value){
  $sha=[System.Security.Cryptography.SHA256]::Create()
  try{
    $bytes=[System.Text.Encoding]::UTF8.GetBytes($Value)
    return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
  }finally{$sha.Dispose()}
}

function Test-TunnelReadyContent([string]$Content){
  return ([string]$Content).Trim() -match '^ready(?:$|\s|\()'
}

function Start-NormalChatGPTApp(){
  $running=Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue
  if($running){Write-Host '[S2-10] PASS - ChatGPT already running';return}
  $app=Get-StartApps | Where-Object { $_.Name -eq 'ChatGPT' } | Select-Object -First 1
  if(-not $app){Fail-Step 'S2-10' 'ChatGPT Windows app is not registered in Start Apps'}
  Write-Host "[S2-10] Starting ChatGPT Windows app: $($app.AppID)"
  Start-Process explorer.exe -ArgumentList "shell:AppsFolder\$($app.AppID)"
  $deadline=(Get-Date).AddSeconds(10)
  do{
    Start-Sleep -Milliseconds 250
    if(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue){Write-Host '[S2-10] PASS - ChatGPT running';return}
  }while((Get-Date)-lt$deadline)
  Fail-Step 'S2-10' 'ChatGPT launch was requested but no ChatGPT process appeared within 10 seconds'
}

function Test-ChatGPTUiRuntime(){
  $activePath=Join-Path $root 'modules\chatgpt-ui\.runtime\active.json'
  if(-not (Test-Path -LiteralPath $activePath -PathType Leaf)){return $false}
  try{
    $active=Get-Content -LiteralPath $activePath -Raw | ConvertFrom-Json
    if(-not $active.port -or -not $active.watcherPid){return $false}
    $watcher=Get-CimInstance Win32_Process -Filter "ProcessId=$($active.watcherPid)" -ErrorAction SilentlyContinue
    if(-not $watcher -or -not $watcher.CommandLine -or $watcher.CommandLine.IndexOf('modules\chatgpt-ui\src\watch.mjs',[System.StringComparison]::OrdinalIgnoreCase) -lt 0){return $false}
    $targets=Invoke-RestMethod -Uri "http://127.0.0.1:$($active.port)/json/list" -TimeoutSec 1
    return (@($targets).Count -gt 0 -and [bool](Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue))
  }catch{return $false}
}

function Start-ChatGPTExperience(){
  $uiEnabled=$true
  if($config.PSObject.Properties.Name -contains 'chatgptUi' -and $config.chatgptUi -and $config.chatgptUi.enabled -eq $false){$uiEnabled=$false}
  if(-not $uiEnabled){Start-NormalChatGPTApp;return}

  if(Test-ChatGPTUiRuntime){Write-Host '[S2-10] PASS - ChatGPT UI runtime already active';return}

  $theme='dark-red'
  if($config.PSObject.Properties.Name -contains 'chatgptUi' -and $config.chatgptUi.theme){$theme=[string]$config.chatgptUi.theme}
  $progressEnabled=$true
  if($config.PSObject.Properties.Name -contains 'chatgptUi' -and $config.chatgptUi -and $config.chatgptUi.PSObject.Properties.Name -contains 'progress' -and $config.chatgptUi.progress -and $config.chatgptUi.progress.enabled -eq $false){$progressEnabled=$false}
  $transportHost=if($config.transport.host){[string]$config.transport.host}else{'127.0.0.1'}
  $transportUrlHost=if($transportHost -eq '::1'){'[::1]'}else{$transportHost}
  $transportPort=if($config.transport.port){[int]$config.transport.port}else{8765}
  $healthPath=if($config.transport.healthPath){[string]$config.transport.healthPath}else{'/health'}
  $transportHealthUrl="http://${transportUrlHost}:$transportPort$healthPath"
  $launcher=Join-Path $root 'modules\chatgpt-ui\scripts\start-chatgpt-ui.ps1'
  if(-not (Test-Path -LiteralPath $launcher -PathType Leaf)){Fail-Step 'S2-10' "ChatGPT UI launcher not found: $launcher"}
  Write-Host "[S2-10] Starting ChatGPT with integrated ChatGPT UI: $theme, progress=$progressEnabled"
  $uiArgs=@('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$launcher,'-Theme',$theme,'-TransportHealthUrl',$transportHealthUrl)
  if(-not $progressEnabled){$uiArgs+='-DisableProgress'}
  & node $boundedProcess 60000 powershell.exe @uiArgs
  if($LASTEXITCODE -ne 0){Fail-Step 'S2-10' "integrated ChatGPT UI launcher failed or exceeded 60 second watchdog (exitCode=$LASTEXITCODE)"}
  if(-not (Test-ChatGPTUiRuntime)){Fail-Step 'S2-10' 'ChatGPT UI launcher returned success but runtime validation failed'}
  Write-Host '[S2-10] PASS - ChatGPT + ChatGPT UI runtime active'
}

function Show-TunnelHealthDiagnostics(){
  Write-Host '[S2-09] ---- tunnel health diagnostics ----'
  $uris=@(
    'http://127.0.0.1:8080/healthz',
    'http://127.0.0.1:8080/readyz'
  )
  foreach($uri in $uris){
    try{
      $response=Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $uri
      Write-Host "[S2-09] $uri -> HTTP $($response.StatusCode) $($response.Content.Trim())"
    }catch{
      $status='request-failed'
      try{if($_.Exception.Response){$status='HTTP '+[int]$_.Exception.Response.StatusCode}}catch{}
      Write-Host "[S2-09] $uri -> $status : $($_.Exception.Message)"
    }
  }

  $healthPidFile=Join-Path (Join-Path $root '.runtime') 'tunnel-client.pid'
  if($client -and (Test-Path -LiteralPath $client -PathType Leaf)){
    Write-Host '[S2-09] tunnel-client control-plane health:'
    try{
      & node $boundedProcess 10000 $client health --port 8080 --pid-file $healthPidFile --require-control-plane-poll --json
      if($LASTEXITCODE -ne 0){Write-Host "[S2-09] tunnel-client health failed or exceeded 10 second watchdog, exitCode=$LASTEXITCODE"}
    }catch{
      Write-Host "[S2-09] tunnel-client health failed: $($_.Exception.Message)"
    }
  }
  Write-Host '[S2-09] ---- end tunnel health diagnostics ----'
}

if(-not $ConfigPath){
  $moduleConfig=Join-Path $root 'modules\transport\config\spark.local.json'
  $runtimeConfig=Join-Path $root '.runtime\config\spark.local.json'
  if(Test-Path -LiteralPath $moduleConfig -PathType Leaf){$ConfigPath=$moduleConfig}else{$ConfigPath=$runtimeConfig}
}
if(-not (Test-Path $ConfigPath)){
  Write-Host '[S2-01] FAIL - local config not found.' -ForegroundColor Red
  Write-Host '         Copy modules\transport\config\spark.example.json to .runtime\config\spark.local.json and edit allowedRoot/tunnel.id.'
  exit 2
}
$ConfigPath=(Resolve-Path $ConfigPath).Path
$env:SPARK_CONFIG=$ConfigPath
try{$config=Get-Content -Raw $ConfigPath | ConvertFrom-Json}catch{Fail-Step 'S2-01' "invalid JSON in local config: $($_.Exception.Message)"}
Write-Host "[S2-01] PASS - Config loaded: $ConfigPath"

if(-not $config.transport.auth -or [string]$config.transport.auth.mode -ne 'bearer'){Fail-Step 'S2-01A' 'transport.auth.mode must be bearer; auth:none is forbidden in SPARK 0.0.1'}
$configuredSparkDigest=[string]$config.transport.auth.bearerTokenSha256
if($configuredSparkDigest -notmatch '^[0-9a-fA-F]{64}$'){Fail-Step 'S2-01A' 'transport.auth.bearerTokenSha256 must be a 64-character SHA-256 digest'}
$accessKeyFile=[string]$config.transport.auth.accessKeyFile
if(-not $accessKeyFile){$accessKeyFile='.runtime/secrets/spark-access-key.txt'}
$accessKeyPath=Resolve-RepoRelative $accessKeyFile
if(-not (Test-Path -LiteralPath $accessKeyPath -PathType Leaf)){Fail-Step 'S2-01A' "SPARK access-key secret file not found: $accessKeyPath"}
$accessKeyValue=(Get-Content -LiteralPath $accessKeyPath -Raw).Trim()
if(-not $accessKeyValue){Fail-Step 'S2-01A' "SPARK access-key secret file is empty: $accessKeyPath"}
$sparkAccessKeySha256=Get-TextSha256 $accessKeyValue
if($sparkAccessKeySha256 -ne $configuredSparkDigest.ToLowerInvariant()){Fail-Step 'S2-01A' 'SPARK access-key secret does not match transport.auth.bearerTokenSha256'}
Write-Host "[S2-01A] PASS - Bearer auth required; SPARK access key verified: $accessKeyPath (value hidden)"

Write-Host '[S2-02] Checking Node.js...'
& node --version
if($LASTEXITCODE -ne 0){Fail-Step 'S2-02' 'Node.js 20+ is required'}
Write-Host '[S2-02] PASS - Node.js available'

if($config.transport.stateDir){
  $transportStateDir=Resolve-RepoRelative ([string]$config.transport.stateDir)
}else{
  $privateBase=$env:LOCALAPPDATA
  if(-not $privateBase){$privateBase=$env:APPDATA}
  if(-not $privateBase){$privateBase=$env:USERPROFILE}
  $transportStateDir=Join-Path $privateBase 'SPARK'
}
$transportLog=Join-Path $transportStateDir 'spark.log'

Write-Host '[S2-03] Starting Transport service...'
Push-Location $root
try {
  $transportStartOutput=@(& node $boundedProcess 15000 cmd.exe /d /c npm run --silent transport:start 2>&1)
  $transportStartExit=$LASTEXITCODE
  if($transportStartExit -ne 0){
    Write-Host '[S2-03] FAIL - Transport start returned a non-zero exit code.' -ForegroundColor Red
    if($transportStartOutput){$transportStartOutput | ForEach-Object { Write-Host "[S2-03] $_" }}
    Write-Host "[S2-03] Transport log: $transportLog"
    if(Test-Path $transportLog){
      Write-Host '[S2-03] ---- Transport log tail ----'
      Get-Content -Path $transportLog -Tail 40
      Write-Host '[S2-03] ---- end Transport log ----'
    }
    throw '[S2-03] Transport start failed'
  }
} finally { Pop-Location }
Write-Host '[S2-03] PASS - Transport service started'

$health="http://$($config.transport.host):$($config.transport.port)$($config.transport.healthPath)"
Write-Host "[S2-04] Health check: $health"
try{$r=Invoke-RestMethod -TimeoutSec 3 $health}catch{Fail-Step 'S2-04' "Transport health request failed: $($_.Exception.Message)"}
if($r.status -ne 'ok'){Fail-Step 'S2-04' 'Transport health response was not ok'}
Write-Host "[S2-04] PASS - Transport healthy, version=$($r.version)"

if($config.tunnel.enabled -eq $false){Write-Host '[S2-05] PASS - Tunnel disabled by config.';Start-ChatGPTExperience;Write-Host '[S2-11] PASS - Startup complete.';exit 0}
if(-not $config.tunnel.id -or $config.tunnel.id -like 'tunnel_x*'){Fail-Step 'S2-05' 'Set tunnel.id in local config'}

$keyFile=$config.tunnel.controlPlaneApiKeyFile
if(-not $keyFile){$keyFile='.runtime/secrets/control-plane-api-key.txt'}
$keyPath=Resolve-RepoRelative ([string]$keyFile)
if(-not (Test-Path $keyPath)){Fail-Step 'S2-05' "Tunnel key file not found: $keyPath"}
$keyPath=(Resolve-Path $keyPath).Path
$keyValue=(Get-Content -Raw $keyPath).Trim()
if(-not $keyValue){Fail-Step 'S2-05' "Tunnel key file is empty: $keyPath"}
$controlPlaneKeySha256=Get-TextSha256 $keyValue
$keyRef="file:$keyPath"
Write-Host "[S2-05] PASS - Tunnel key file: $keyPath (value hidden)"

$clientDir=$config.tunnel.clientDir
if(-not [System.IO.Path]::IsPathRooted($clientDir)){$clientDir=Join-Path $root $clientDir}
Write-Host "[S2-06] Checking tunnel-client: $clientDir"
& node $boundedProcess 180000 powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'modules\transport\scripts\bootstrap-tunnel.ps1') -Version $config.tunnel.clientVersion -ClientDir $clientDir
if($LASTEXITCODE -ne 0){Fail-Step 'S2-06' "tunnel-client bootstrap failed or exceeded 180 second watchdog (exitCode=$LASTEXITCODE)"}
$client=Join-Path $clientDir 'tunnel-client.exe'
if(-not (Test-Path $client)){Fail-Step 'S2-06' "tunnel-client.exe not found after bootstrap: $client"}
Write-Host "[S2-06] PASS - tunnel-client ready: $client"

$profile=$config.tunnel.profile
$runtime=Join-Path $root '.runtime';New-Item -ItemType Directory -Force $runtime|Out-Null
$profileDir=Join-Path $runtime 'tunnel-profiles';New-Item -ItemType Directory -Force $profileDir|Out-Null
$profilePath=Join-Path $profileDir ($profile + '.yaml')
$runtimeStatePath=Join-Path $runtime 'tunnel-runtime.json'
$existingTunnelPidFile=Join-Path $runtime 'tunnel-client.pid'

function Get-TunnelProfileId([string]$Path){
  if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){return $null}
  $match=[regex]::Match((Get-Content -LiteralPath $Path -Raw),'(?m)^\s*tunnel_id:\s*"?([^"\r\n#]+)"?\s*$')
  if(-not $match.Success){return $null}
  return $match.Groups[1].Value.Trim()
}

function Get-TunnelProfileHash([string]$Path){
  if(-not (Test-Path -LiteralPath $Path -PathType Leaf)){return $null}
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Backup-TunnelProfile([string]$Reason){
  $backupDir=Join-Path $runtime 'tunnel-profile-backups';New-Item -ItemType Directory -Force $backupDir|Out-Null
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupPath=Join-Path $backupDir ($profile + '-' + $stamp + '.yaml')
  Copy-Item -LiteralPath $profilePath -Destination $backupPath -Force
  if(-not (Test-Path -LiteralPath $backupPath -PathType Leaf)){Fail-Step 'S2-07' 'failed to create tunnel profile recovery backup'}
  if((Get-TunnelProfileHash $profilePath) -ne (Get-TunnelProfileHash $backupPath)){Fail-Step 'S2-07' 'tunnel profile recovery backup hash mismatch'}
  Write-Host "[S2-07] $Reason; backup verified: $backupPath"
}

function Stop-OwnedTunnel([int]$TunnelPid,[string]$Reason){
  Write-Host "[S2-07] $Reason; stopping SPARK-owned tunnel-client PID=$TunnelPid"
  try{Stop-Process -Id $TunnelPid -Force -ErrorAction Stop}catch{Fail-Step 'S2-07' "failed to stop SPARK-owned tunnel-client PID=$TunnelPid : $($_.Exception.Message)"}
  $deadline=(Get-Date).AddSeconds(10)
  while((Get-Process -Id $TunnelPid -ErrorAction SilentlyContinue) -and (Get-Date)-lt$deadline){Start-Sleep -Milliseconds 200}
  if(Get-Process -Id $TunnelPid -ErrorAction SilentlyContinue){Fail-Step 'S2-07' "SPARK-owned tunnel-client PID=$TunnelPid did not stop within 10 seconds"}
  Remove-Item -LiteralPath $existingTunnelPidFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $runtimeStatePath -Force -ErrorAction SilentlyContinue
}

function Test-TunnelControlPlanePoll(){
  try{
    $healthOutput=& node $boundedProcess 10000 $client health --port 8080 --require-control-plane-poll --json 2>$null
    if($LASTEXITCODE -ne 0){return $false}
    $healthJson=($healthOutput -join [Environment]::NewLine) | ConvertFrom-Json
    return ($healthJson.result -eq 'ok' -and $healthJson.control_plane_poll.ok -eq $true)
  }catch{return $false}
}

$existingTunnelOwned=$false
$existingTunnelPid=$null
$existingTunnelProcess=$null
if(Test-Path -LiteralPath $existingTunnelPidFile -PathType Leaf){
  try{
    $existingTunnelPid=[int](Get-Content -LiteralPath $existingTunnelPidFile | Select-Object -First 1)
    $existingTunnelProcess=Get-Process -Id $existingTunnelPid -ErrorAction Stop
    if($existingTunnelProcess.ProcessName -eq 'tunnel-client'){$existingTunnelOwned=$true}
  }catch{}
}

$listenerReady=$false
try{
  $ready=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:8080/readyz'
  $listenerReady=(Test-TunnelReadyContent $ready.Content)
}catch{}
if($listenerReady -and -not $existingTunnelOwned){Fail-Step 'S2-07' 'Port 8080 reports ready but is not owned by the SPARK tunnel PID file; refusing to reuse an unknown listener'}

$profileTunnelId=Get-TunnelProfileId $profilePath
$profileHash=Get-TunnelProfileHash $profilePath
$runtimeState=$null
if(Test-Path -LiteralPath $runtimeStatePath -PathType Leaf){
  try{$runtimeState=Get-Content -LiteralPath $runtimeStatePath -Raw | ConvertFrom-Json}catch{}
}
$runtimeIdentityOk=$false
if($listenerReady -and $existingTunnelOwned -and $runtimeState -and $profileTunnelId -and $profileHash){
  $runtimeIdentityOk=(
    [int]$runtimeState.pid -eq $existingTunnelPid -and
    [string]$runtimeState.tunnelId -eq [string]$config.tunnel.id -and
    [string]$runtimeState.controlPlaneKeySha256 -eq [string]$controlPlaneKeySha256 -and
    [string]$runtimeState.sparkAccessKeySha256 -eq [string]$sparkAccessKeySha256 -and
    [string]$runtimeState.profilePath -ieq [string]$profilePath -and
    [string]$runtimeState.profileSha256 -eq [string]$profileHash -and
    [string]$profileTunnelId -eq [string]$config.tunnel.id
  )
}

if($runtimeIdentityOk -and (Test-TunnelControlPlanePoll)){
  Write-Host "[S2-07] PASS - Existing SPARK tunnel identity verified for $($config.tunnel.id), PID=$existingTunnelPid"
  Start-ChatGPTExperience
  Write-Host '[S2-11] PASS - Startup complete.'
  exit 0
}

if($existingTunnelOwned){
  $reason='existing tunnel identity could not be verified against current config/profile'
  if($profileTunnelId -and $profileTunnelId -ne [string]$config.tunnel.id){$reason="tunnel ID mismatch: config=$($config.tunnel.id), profile=$profileTunnelId"}
  Stop-OwnedTunnel $existingTunnelPid $reason
  $listenerReady=$false
}

Write-Host "[S2-07] Checking tunnel profile: $profile"
Write-Host "[S2-07] SPARK profile directory: $profileDir"
$profileTunnelId=Get-TunnelProfileId $profilePath
if(Test-Path -LiteralPath $profilePath -PathType Leaf){
  if(-not $profileTunnelId -or $profileTunnelId -ne [string]$config.tunnel.id){
    Backup-TunnelProfile "Tunnel profile ID does not match current config (config=$($config.tunnel.id), profile=$profileTunnelId)"
    Write-Host '[S2-07] Reinitializing SPARK-owned profile for current tunnel ID...'
    & node $boundedProcess 30000 $client init --force --sample sample_mcp_remote_no_auth --profile $profile --profile-dir $profileDir --tunnel-id $config.tunnel.id --mcp-server-url $config.tunnel.localMcpUrl --control-plane-api-key-ref $keyRef
    if($LASTEXITCODE -ne 0){Fail-Step 'S2-07' "tunnel profile reinit failed or exceeded 30 second watchdog (exitCode=$LASTEXITCODE)"}
  }else{
    & node $boundedProcess 30000 $client doctor --profile $profile --profile-dir $profileDir --explain *> (Join-Path $runtime 'tunnel-doctor.log')
    if($LASTEXITCODE -ne 0){
      Backup-TunnelProfile 'Existing SPARK profile failed doctor or exceeded watchdog'
      Write-Host '[S2-07] Reinitializing SPARK-owned profile...'
      & node $boundedProcess 30000 $client init --force --sample sample_mcp_remote_no_auth --profile $profile --profile-dir $profileDir --tunnel-id $config.tunnel.id --mcp-server-url $config.tunnel.localMcpUrl --control-plane-api-key-ref $keyRef
      if($LASTEXITCODE -ne 0){Fail-Step 'S2-07' "tunnel profile reinit failed or exceeded 30 second watchdog (exitCode=$LASTEXITCODE)"}
    }
  }
}else{
  Write-Host '[S2-07] SPARK-owned profile not found; initializing no-auth MCP profile...'
  & node $boundedProcess 30000 $client init --sample sample_mcp_remote_no_auth --profile $profile --profile-dir $profileDir --tunnel-id $config.tunnel.id --mcp-server-url $config.tunnel.localMcpUrl --control-plane-api-key-ref $keyRef
  if($LASTEXITCODE -ne 0){Fail-Step 'S2-07' "tunnel profile init failed or exceeded 30 second watchdog (exitCode=$LASTEXITCODE)"}
}

$profileTunnelId=Get-TunnelProfileId $profilePath
if($profileTunnelId -ne [string]$config.tunnel.id){Fail-Step 'S2-07' "tunnel profile ID mismatch after initialization: config=$($config.tunnel.id), profile=$profileTunnelId"}
& node $boundedProcess 30000 $client doctor --profile $profile --profile-dir $profileDir --explain *> (Join-Path $runtime 'tunnel-doctor.log')
if($LASTEXITCODE -ne 0){Fail-Step 'S2-07' "tunnel doctor failed or exceeded 30 second watchdog (exitCode=$LASTEXITCODE)"}
Write-Host "[S2-07] PASS - tunnel profile ready for $profileTunnelId"

try{
  $ready=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:8080/readyz'
  if(Test-TunnelReadyContent $ready.Content){Fail-Step 'S2-08' 'Port 8080 is still ready after stale/unverified SPARK tunnel cleanup; refusing to start another tunnel-client'}
}catch{
  if($_.Exception.Message.StartsWith('[S2-08]')){throw}
}

Write-Host '[S2-08] Starting tunnel-client with direct CreateProcess semantics...'
$psi=New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName=$client
$psi.Arguments="run --profile `"$profile`" --profile-dir `"$profileDir`""
$psi.WorkingDirectory=$root
$psi.UseShellExecute=$false
$psi.CreateNoWindow=$true
$proc=New-Object System.Diagnostics.Process
$proc.StartInfo=$psi
try{
  $started=$proc.Start()
  if(-not $started){Fail-Step 'S2-08' 'tunnel-client process did not start'}
}catch{
  Fail-Step 'S2-08' "tunnel-client launch failed: $($_.Exception.Message)"
}
Set-Content -Encoding ascii (Join-Path $runtime 'tunnel-client.pid') $proc.Id
$profileHash=Get-TunnelProfileHash $profilePath
$runtimeState=[ordered]@{
  pid=$proc.Id
  tunnelId=[string]$config.tunnel.id
  controlPlaneKeySha256=[string]$controlPlaneKeySha256
  sparkAccessKeySha256=[string]$sparkAccessKeySha256
  profile=[string]$profile
  profilePath=[string]$profilePath
  profileSha256=[string]$profileHash
  startedAt=(Get-Date).ToString('o')
}
$runtimeState | ConvertTo-Json | Set-Content -LiteralPath $runtimeStatePath -Encoding utf8
if(-not (Test-Path -LiteralPath $runtimeStatePath -PathType Leaf)){Fail-Step 'S2-08' 'failed to persist tunnel runtime identity state'}
Write-Host "[S2-08] PASS - tunnel-client started, PID=$($proc.Id), tunnelId=$($config.tunnel.id)"

$readyTimeoutSeconds=60
Write-Host "[S2-09] Waiting for tunnel /readyz + successful Control Plane poll (up to $readyTimeoutSeconds seconds)..."
$deadline=(Get-Date).AddSeconds($readyTimeoutSeconds)
do{
  Start-Sleep -Milliseconds 500
  if($proc.HasExited){
    Show-TunnelHealthDiagnostics
    Fail-Step 'S2-09' "tunnel-client exited before readiness acceptance, exitCode=$($proc.ExitCode). Check .runtime\tunnel-doctor.log and run tunnel-client.exe run --profile $profile --profile-dir $profileDir manually for console diagnostics."
  }
  try{
    $ready=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:8080/readyz'
    if(Test-TunnelReadyContent $ready.Content -and (Test-TunnelControlPlanePoll)){
      Write-Host "[S2-09] PASS - tunnel ready + Control Plane poll OK (PID $($proc.Id), tunnelId=$($config.tunnel.id))"
      Start-ChatGPTExperience
      Write-Host '[S2-11] PASS - Startup complete.'
      exit 0
    }
  }catch{}
}while((Get-Date)-lt$deadline)

Show-TunnelHealthDiagnostics
if(-not $proc.HasExited){
  Write-Host "[S2-09] INFO - tunnel-client remains running as PID $($proc.Id) so readiness diagnostics are preserved. Run SPARK.cmd stop to clean it up."
}
Fail-Step 'S2-09' "tunnel-client did not become ready within $readyTimeoutSeconds seconds"
