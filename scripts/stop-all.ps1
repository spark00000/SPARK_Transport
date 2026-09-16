param([string]$ConfigPath)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$boundedProcess=Join-Path $root 'modules\transport\src\bounded-process-cli.mjs'
if(-not $ConfigPath){
  $moduleConfig=Join-Path $root 'modules\transport\config\spark.local.json'
  $runtimeConfig=Join-Path $root '.runtime\config\spark.local.json'
  if(Test-Path -LiteralPath $moduleConfig -PathType Leaf){$ConfigPath=$moduleConfig}else{$ConfigPath=$runtimeConfig}
}
$env:SPARK_CONFIG=$ConfigPath
$runtime=Join-Path $root '.runtime'
$pidFile=Join-Path $runtime 'tunnel-client.pid'

Write-Host '[S2-STOP-01] Stopping tunnel-client...'
if(Test-Path $pidFile){
  $tunnelPid=[int](Get-Content $pidFile | Select-Object -First 1)
  Stop-Process -Id $tunnelPid -ErrorAction SilentlyContinue
  $deadline=(Get-Date).AddSeconds(5)
  while((Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue) -and (Get-Date)-lt$deadline){Start-Sleep -Milliseconds 100}
  if(Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue){
    & node $boundedProcess 5000 taskkill.exe /PID $tunnelPid /T /F *> $null
    $forceDeadline=(Get-Date).AddSeconds(3)
    while((Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue) -and (Get-Date)-lt$forceDeadline){Start-Sleep -Milliseconds 100}
  }
  if(Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue){throw "tunnel-client PID=$tunnelPid did not stop within bounded cleanup"}
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "[S2-STOP-01] PASS - tunnel-client stopped, PID=$tunnelPid"
}else{
  Write-Host '[S2-STOP-01] PASS - no tunnel PID file present'
}

Write-Host '[S2-STOP-02] Stopping Transport service...'
Push-Location $root
try{
  & node $boundedProcess 15000 cmd.exe /d /c npm run transport:stop
  if($LASTEXITCODE -ne 0){throw "Transport stop failed or exceeded 15 second watchdog (exitCode=$LASTEXITCODE)"}
}finally{Pop-Location}
Write-Host '[S2-STOP-02] PASS - Transport service stopped or already stopped'

Write-Host '[S2-STOP-03] Stopping ChatGPT UI watcher...'
$uiActivePath=Join-Path $root 'modules\chatgpt-ui\.runtime\active.json'
if(Test-Path -LiteralPath $uiActivePath -PathType Leaf){
  try{
    $uiActive=Get-Content -LiteralPath $uiActivePath -Raw | ConvertFrom-Json
    if($uiActive.watcherPid){
      $watcher=Get-CimInstance Win32_Process -Filter "ProcessId=$($uiActive.watcherPid)" -ErrorAction SilentlyContinue
      if($watcher -and $watcher.CommandLine -and $watcher.CommandLine.IndexOf('modules\chatgpt-ui\src\watch.mjs',[System.StringComparison]::OrdinalIgnoreCase) -ge 0){
        Stop-Process -Id $watcher.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
  }catch{}
  Remove-Item -LiteralPath $uiActivePath -Force -ErrorAction SilentlyContinue
}
Write-Host '[S2-STOP-03] PASS - ChatGPT UI watcher stopped or not active'

Write-Host '[S2-STOP-04] Stopping ChatGPT Windows app...'
$chatProcesses=Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue
if($chatProcesses){
  $chatProcesses | Stop-Process -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 300
  Write-Host '[S2-STOP-04] PASS - ChatGPT stop requested'
}else{
  Write-Host '[S2-STOP-04] PASS - ChatGPT is not running'
}
